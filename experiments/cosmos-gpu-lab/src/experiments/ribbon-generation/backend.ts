import { Buffer, type Device, type QuerySet } from '@luma.gl/core'
import { Kernel, RenderKernel } from '@luma.gl/graph'
import { ALPHA_BLEND, bindingLayout, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { pixels, target, type RgbaSnapshot } from '../../gpu/rgba-readback'
import { readLumaTimer } from '../weighted-links/timing'
import { WIDTH, HEIGHT, resolveLink, type Scene, type Settings } from '../curved-links/data'
import { productionGeometry } from '../curved-links/geometry'
import { vertexSource, cachedSource, computeSource } from './shaders'
export const LANES = ['vertex', 'rebuild', 'reuse'] as const
export type Lane = typeof LANES[number]
export type Measurement = { gpuMs: number | null; computeMs: number | null; renderMs: number | null; wallMs: number; submitMs: number; timerStatus: string; frames: number }
export type RibbonResources = {
  sampleBytes: number;
  snapshot(lane: Lane): Promise<RgbaSnapshot>;
  measure(lane: Lane, picking: boolean, frames?: number, timed?: boolean): Promise<Measurement>;
  destroy(): void;
}
export function createRibbonResources (device: Device, scene: Scene, settings: Settings): RibbonResources {
  const scope = resourceScope(); const sampleBytes = scene.links.length * (settings.segments + 1) * 16
  try {
    if (!scene.links.length || Math.ceil(scene.links.length * (settings.segments + 1) / 64) > device.limits.maxComputeWorkgroupsPerDimension) {
      throw new Error('Workload is empty or exceeds the one-dimensional dispatch limit')
    }
    const positions = new Float32Array(scene.points.length * 4)
    scene.points.forEach((p, i) => positions.set([p.x - WIDTH / 2, HEIGHT / 2 - p.y, Number(!!p.absent), 0], i * 4))
    const order = scene.links.map((_, i) => i); if (settings.reverse) order.reverse()
    const storage = new ArrayBuffer(scene.links.length * 48); const indices = new Uint32Array(storage); const values = new Float32Array(storage)
    order.forEach((id, i) => {
      const link = resolveLink(scene.links[id], settings)
      indices.set([link.source, link.target, id, 0], i * 12); values.set([...link.color, link.width, 0, 0, 0], i * 12 + 4)
    })
    for (const size of [sampleBytes, positions.byteLength, storage.byteLength]) {
      if (size > device.limits.maxStorageBufferBindingSize || size > device.limits.maxBufferSize) throw new Error('Workload exceeds device buffer limits')
    }
    const geometry = productionGeometry(settings)
    const base = { positions: scope.own(upload(device, positions)), links: scope.own(upload(device, new Uint8Array(storage))), nodes: scope.own(upload(device, geometry)) }
    const samples = scope.own(device.createBuffer({ byteLength: sampleBytes, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const params = [0, 1].map(mode => scope.own(upload(device, new Float32Array([
      WIDTH, HEIGHT, settings.zoom, settings.ratio, settings.widthScale, settings.maxWidth, settings.opacity, settings.indexOffset,
      Number(settings.scaleOnZoom), Number(settings.blend), mode, 1, settings.segments, settings.weight, settings.controlDistance, 0,
    ]), Buffer.UNIFORM)))
    const entries: Array<[string, 'read-only-storage' | 'uniform']> = [['positions', 'read-only-storage'], ['links', 'read-only-storage'], ['params', 'uniform'], ['nodes', 'read-only-storage']]
    const compute = scope.own(new Kernel(device, { source: computeSource, shaderLayout: { bindings: bindingLayout([...entries, ['samples', 'storage']]) } }))
    const renderers = [false, true].map(cached => {
      const source = cached ? cachedSource : vertexSource
      const shaderLayout = { attributes: [], bindings: bindingLayout(cached ? [...entries, ['samples', 'read-only-storage']] : entries) }
      return {
        vertexArray: scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] })),
        kernels: [false, true].map(picking => scope.own(new RenderKernel(device, {
          vertexSource: source,
          fragmentSource: source,
          vertexEntryPoint: 'vertexMain',
          fragmentEntryPoint: 'fragmentMain',
          topology: 'triangle-strip',
          shaderLayout,
          colorAttachmentFormats: ['rgba8unorm'],
          parameters: { ...(settings.blend && !picking ? ALPHA_BLEND : { blend: false }), cullMode: 'back' },
        }))),
      }
    })
    const targets = [0, 1].map(() => scope.own(target(device, WIDTH * settings.ratio, HEIGHT * settings.ratio)))
    let initialized = false
    const encode = (lane: Lane, picking: boolean, query?: QuerySet, offset = 0): number => {
      let pair = offset
      const stamp = (): { timestampQuerySet?: QuerySet; beginTimestampIndex?: number; endTimestampIndex?: number } => query ? { timestampQuerySet: query, beginTimestampIndex: pair++ * 2, endTimestampIndex: (pair - 1) * 2 + 1 } : {}
      if (lane === 'rebuild' || (lane === 'reuse' && !initialized)) {
        const pass = device.beginComputePass(stamp())
        try { compute.dispatch(pass, { x: Math.ceil(scene.links.length * (settings.segments + 1) / 64), bindings: { ...base, params: params[0], samples } }) } finally { pass.end() }
        initialized = true
      }
      const renderer = renderers[Number(lane !== 'vertex')]
      for (let mode = 0; mode < (picking ? 2 : 1); mode++) {
        const pass = device.beginRenderPass({ framebuffer: targets[mode].framebuffer, clearColor: [0, 0, 0, 0], ...stamp() })
        try {
          renderer.kernels[mode].draw(pass, {
            vertexArray: renderer.vertexArray,
            vertexCount: geometry.length / 2,
            instanceCount: scene.links.length,
            bindings: { ...base, params: params[mode], ...(lane !== 'vertex' ? { samples } : {}) },
          })
        } finally { pass.end() }
      }
      return pair
    }
    return {
      sampleBytes,
      async snapshot (lane: Lane): Promise<RgbaSnapshot> {
        encode(lane, true); device.submit(); await waitForGpu(device)
        return {
          width: WIDTH * settings.ratio,
          height: HEIGHT * settings.ratio,
          color: await pixels(device, targets[0].texture, targets[0].framebuffer),
          ids: await pixels(device, targets[1].texture, targets[1].framebuffer),
        }
      },
      async measure (lane: Lane, picking: boolean, frames = 8, timed = true): Promise<Measurement> {
        // Initialize the static cache before timing; rebuilding lanes still pay every frame.
        if (!initialized && lane === 'reuse') { encode('rebuild', picking); await waitForGpu(device) }
        await waitForGpu(device)
        const perFrame = (lane === 'rebuild' ? 1 : 0) + (picking ? 2 : 1)
        const query = timed && device.features.has('timestamp-query') ? device.createQuerySet({ type: 'timestamp', count: frames * perFrame * 2 }) : undefined
        let computeMs: number | null = null; let renderMs: number | null = null
        try {
          const start = performance.now()
          for (let i = 0; i < frames; i++) encode(lane, picking, query, i * perFrame)
          device.submit(); const submitted = performance.now(); await waitForGpu(device); const completed = performance.now()
          const result = query
            ? await readLumaTimer({
              async readTimestampDuration () {
                const data = await query.readResults({ firstQuery: 0, queryCount: frames * perFrame * 2 })
                if (data.length !== frames * perFrame * 2) return NaN
                let c = 0n; let r = 0n
                for (let p = 0; p < frames * perFrame; p++) {
                  const delta = data[p * 2 + 1] - data[p * 2]; if (delta < 0n || data[p * 2 + 1] === 0n) return NaN
                  if (lane === 'rebuild' && p % perFrame === 0) c += delta; else r += delta
                }
                computeMs = Number(c) / 1e6 / frames; renderMs = Number(r) / 1e6 / frames
                return computeMs + renderMs
              },
            })
            : { milliseconds: null, status: 'unavailable' }
          return {
            gpuMs: result.milliseconds,
            computeMs: result.milliseconds === null ? null : computeMs,
            renderMs: result.milliseconds === null ? null : renderMs,
            wallMs: (completed - start) / frames,
            submitMs: (submitted - start) / frames,
            timerStatus: result.status,
            frames,
          }
        } finally { query?.destroy() }
      },
      destroy: (): void => scope.destroy(),
    }
  } catch (error) { scope.destroy(); throw error }
}
