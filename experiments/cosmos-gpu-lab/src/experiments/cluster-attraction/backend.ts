import { Buffer, Texture, UniformStore, type ComputePass, type Device } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { createRoundedKernel, roundedArithmetic, roundedIntegrationSource } from '../combined-layout/spring-precision'
import { createWebGL } from '../many-body/webgl'
import { createWebGPU } from '../many-body/webgpu'
import type { Backend } from '../many-body/backend'
import { measureBatch, timestamps, type Measurement, type TimestampWrites } from '../many-body/timing'
import aggregateVert from '../../../../../src/modules/Clusters/calculate-centermass.vert?raw'
import aggregateFrag from '../../../../../src/modules/Clusters/calculate-centermass.frag?raw'
import forceFrag from '../../../../../src/modules/Clusters/force-cluster.frag?raw'
import quadVert from '../../../../../src/modules/Shared/quad.vert?raw'
import type { ClusterSnapshot } from './reference'
import { SETTINGS, grouping, validate, type ClusterInput } from './data'
import reduction from './reduce.wgsl?raw'
import forceSource from './force.wgsl?raw'
export type Api = 'webgl' | 'webgpu'
// A destroyed luma device must not be rediscovered through the old canvas context.
export function replaceCanvas (previous: HTMLCanvasElement): HTMLCanvasElement {
  const next = previous.cloneNode(false) as HTMLCanvasElement
  previous.replaceWith(next)
  return next
}
export type ClusterBackend = Omit<Backend, 'read'> & {
  read(): Promise<ClusterSnapshot>;
  updateClusters(input: ClusterInput): void;
  measureForce(operations: number): Promise<Measurement>;
  environment(): { browser: string; device: Device['info']; timestamps: boolean; visible: boolean;
    canvas: { width: number; height: number; cssWidth: number; cssHeight: number; dpr: number }; };
}
function describeEnvironment (device: Device, canvas: HTMLCanvasElement): ReturnType<ClusterBackend['environment']> {
  const rect = canvas.getBoundingClientRect()
  return {
    browser: navigator.userAgent,
    device: device.info,
    timestamps: device.features.has('timestamp-query'),
    visible: document.visibilityState === 'visible',
    canvas: { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height, dpr: window.devicePixelRatio },
  }
}
export async function createBackend (api: Api, canvas: HTMLCanvasElement, input: ClusterInput): Promise<ClusterBackend> {
  validate(input)
  const count = input.membership.length; const groups = input.targets.length / 4
  let readAggregates!: () => Promise<Float32Array>
  let update!: (next: ClusterInput) => void; let measure!: ClusterBackend['measureForce']; let environment!: ClusterBackend['environment']
  const base = api === 'webgl'
    ? await createWebGL(canvas, input, SETTINGS, ({ device, positions, exit, target, size }) => {
      const scope = resourceScope(); const own = scope.own
      try {
        const edge = Math.ceil(Math.sqrt(groups))
        const texture = (width: number): Texture => own(device.createTexture({
          width,
          height: width,
          format: 'rgba32float',
          usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_SRC | Texture.COPY_DST,
          sampler: { minFilter: 'nearest', magFilter: 'nearest' },
        }))
        const clusters = texture(size); const targets = texture(edge); const strengths = texture(size); const sums = texture(edge)
        const framebuffer = own(device.createFramebuffer({ width: edge, height: edge, colorAttachments: [sums] }))
        const uniforms = own(new UniformStore(device, {
          calculateCentermassUniforms: { uniformTypes: { clustersTextureSize: 'f32' } },
          applyForcesUniforms: { uniformTypes: { alpha: 'f32', clusterCoefficient: 'f32' } },
        }))
        const ids = new Float32Array(count * 2)
        for (let i = 0; i < count; i++) ids.set([i % size, Math.floor(i / size)], i * 2)
        const pointIndices = own(upload(device, ids, Buffer.VERTEX))
        const quad = own(upload(device, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), Buffer.VERTEX))
        const params = { depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' } as const
        const aggregate = own(new Model(device, {
          vs: aggregateVert,
          fs: aggregateFrag,
          defines: { USE_UNIFORM_BUFFERS: true },
          topology: 'point-list',
          vertexCount: count,
          attributes: { pointIndices },
          bufferLayout: [{ name: 'pointIndices', format: 'float32x2' }],
          bindings: { calculateCentermassUniforms: uniforms.getManagedUniformBuffer('calculateCentermassUniforms'), clusterTexture: clusters, exitTexture: exit },
          parameters: {
            ...params,
            blend: true,
            blendColorOperation: 'add',
            blendColorSrcFactor: 'one',
            blendColorDstFactor: 'one',
            blendAlphaOperation: 'add',
            blendAlphaSrcFactor: 'one',
            blendAlphaDstFactor: 'one',
          },
        }))
        const force = own(new Model(device, {
          vs: quadVert,
          fs: forceFrag,
          defines: { USE_UNIFORM_BUFFERS: true },
          topology: 'triangle-strip',
          vertexCount: 4,
          attributes: { vertexCoord: quad },
          bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
          bindings: {
            applyForcesUniforms: uniforms.getManagedUniformBuffer('applyForcesUniforms'),
            centermassTexture: sums,
            clusterTexture: clusters,
            clusterPositionsTexture: targets,
            clusterForceCoefficient: strengths,
          },
          parameters: { ...params, blend: false },
        }))
        const write = (t: Texture, values: Float32Array, width: number): void => {
          const padded = new Float32Array(width * width * 4); padded.set(values)
          t.copyImageData({ data: padded, bytesPerRow: width * 16, mipLevel: 0, x: 0, y: 0 })
        }
        update = (next): void => {
          const ids = new Float32Array(size * size * 4).fill(-1); const coefficients = new Float32Array(size * size * 4)
          for (let i = 0; i < count; i++) {
            const group = next.membership[i]
            ids.set(group < 0 ? [-1, -1, 0, 0] : [group % edge, Math.floor(group / edge), 0, 0], i * 4)
            coefficients[i * 4] = next.strengths[i]
          }
          write(clusters, ids, size); write(strengths, coefficients, size); write(targets, next.targets, edge)
        }
        // Managed buffers must exist before UniformStore propagates the initial values.
        uniforms.setUniforms({
          calculateCentermassUniforms: { clustersTextureSize: edge },
          applyForcesUniforms: { alpha: SETTINGS.alpha, clusterCoefficient: SETTINGS.strength },
        })
        update(input)
        const encode = (source: number): void => {
          aggregate.setBindings({ positionsTexture: positions[source] })
          const sumPass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
          try { aggregate.draw(sumPass) } finally { sumPass.end() }
          force.setBindings({ positionsTexture: positions[source] })
          const pass = device.beginRenderPass({ framebuffer: target, clearColor: [0, 0, 0, 0], clearDepth: false })
          try { force.draw(pass) } finally { pass.end() }
        }
        readAggregates = async (): Promise<Float32Array> => {
          const data = sums.readDataSyncWebGL()
          return (data instanceof ArrayBuffer ? new Float32Array(data) : new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)).slice(0, groups * 4)
        }
        measure = (operations): Promise<Measurement> => measureBatch(device, operations, () => encode(0))
        environment = (): ReturnType<ClusterBackend['environment']> => describeEnvironment(device, canvas)
        return { encode, destroy: scope.destroy }
      } catch (error) { scope.destroy(); throw error }
    })
    : await createWebGPU(canvas, input, SETTINGS, 'direct', async ({ device, positions, forces }) => {
      const scope = resourceScope(); const own = scope.own
      try {
        const capacity = Math.ceil(count / 256) + groups
        const storage = (bytes: number): Buffer => own(device.createBuffer({ byteLength: Math.max(32, bytes), usage: Buffer.STORAGE | Buffer.COPY_SRC | Buffer.COPY_DST }))
        const members = storage(count * 4); const chunks = storage(capacity * 16); const ranges = storage(groups * 16)
        const partials = storage(capacity * 32); const dummy = storage(32); const sums = storage(groups * 16)
        const membership = storage(count * 4); const targets = storage(groups * 16); const strengths = storage(count * 4)
        const params = own(upload(device, new Float32Array([count, SETTINGS.alpha, SETTINGS.strength, 0]), Buffer.UNIFORM))
        const integrationParams = own(upload(device, new Float32Array([count, 0, 0, 0, SETTINGS.friction, SETTINGS.referenceLength, 0, 0]), Buffer.UNIFORM))
        const bindings = bindingLayout([['points', 'read-only-storage'], ['members', 'read-only-storage'], ['ranges', 'read-only-storage'],
          ['previous', 'read-only-storage'], ['partials', 'storage'], ['aggregates', 'storage']])
        const reduce = own(await createRoundedKernel(device, reduction.replaceAll('SOURCE_POINTS', 'true'), bindings))
        const finish = own(await createRoundedKernel(device, reduction.replaceAll('SOURCE_POINTS', 'false'), bindings))
        const force = own(await createRoundedKernel(device, roundedArithmetic + forceSource, bindingLayout([
          ['positions', 'read-only-storage'], ['aggregates', 'read-only-storage'], ['membership', 'read-only-storage'], ['targets', 'read-only-storage'],
          ['strengths', 'read-only-storage'], ['forces', 'storage'], ['params', 'uniform'],
        ])))
        const integrate = own(await createRoundedKernel(device, roundedIntegrationSource(), bindingLayout([
          ['positions', 'read-only-storage'], ['forces', 'read-only-storage'], ['params', 'uniform'], ['output', 'storage'],
        ])))
        let chunkCount = 0
        update = (next): void => {
          const index = grouping(next); chunkCount = index.chunks.length / 4
          if (index.members.byteLength) members.write(index.members)
          if (index.chunks.byteLength) chunks.write(index.chunks)
          ranges.write(index.ranges); targets.write(next.targets)
          if (count) { membership.write(next.membership); strengths.write(next.strengths) }
        }
        update(input)
        const encode = (source: number, timing: TimestampWrites, shared?: ComputePass): void => {
          const pass = shared ?? device.beginComputePass(timing)
          try {
            if (chunkCount) reduce.dispatch(pass, { x: chunkCount, bindings: { points: positions[source], members, ranges: chunks, previous: dummy, partials, aggregates: sums } })
            finish.dispatch(pass, { x: groups, bindings: { points: positions[source], members, ranges, previous: partials, partials: dummy, aggregates: sums } })
            if (count) force.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions: positions[source], aggregates: sums, membership, targets, strengths, forces, params } })
          } finally { if (!shared) pass.end() }
        }
        readAggregates = (): Promise<Float32Array> => readFloats(sums, groups * 16)
        measure = (operations): Promise<Measurement> => measureBatch(device, operations, (query, first, last) => encode(0, timestamps(query, first, last)))
        environment = (): ReturnType<ClusterBackend['environment']> => describeEnvironment(device, canvas)
        return {
          encode,
          integrate (source, timing, shared): boolean {
            const pass = shared ?? device.beginComputePass(timing)
            try { integrate.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions: positions[source], forces, params: integrationParams, output: positions[1 - source] } }) } finally { if (!shared) pass.end() }
            return true
          },
          destroy: scope.destroy,
        }
      } catch (error) { scope.destroy(); throw error }
    })
  const description = environment().device
  return {
    ...base,
    info: `${base.info}; ${description.gpuArchitecture ?? description.gpuBackend}; fallback ${description.fallback ?? 'not exposed'}`,
    async read (): Promise<ClusterSnapshot> { return { ...await base.read(), aggregates: await readAggregates() } },
    updateClusters (next): void {
      validate(next)
      if (next.membership.length !== count || next.targets.length !== groups * 4) throw new Error('Count changes require data replacement')
      update(next)
    },
    measureForce: measure,
    environment,
  }
}
