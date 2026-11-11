import { Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { withGridCell } from '../../../../../src/modules/ForceManyBody/grid-cell'
import aggregateVert from '../../../../../src/modules/ForceManyBody/calculate-level.vert?raw'
import aggregateFrag from '../../../../../src/modules/ForceManyBody/calculate-level.frag?raw'
import levelFrag from '../../../../../src/modules/ForceManyBody/force-level.frag?raw'
import nearFrag from '../../../../../src/modules/ForceManyBody/force-nearfield.frag?raw'
import slotsVert from '../../../../../src/modules/ForceManyBody/build-nearfield-slots.vert?raw'
import slotsFrag from '../../../../../src/modules/ForceManyBody/build-nearfield-slots.frag?raw'
import quadVert from '../../../../../src/modules/Shared/quad.vert?raw'
import { createWebGL, type WebGLForceFactory } from '../many-body/webgl'
import { nearLimit, type Input, type Parameters } from '../many-body/data'
import { nearTraceShader, type Trace } from './trace'
import { layout, type Frame, type Structure } from './data'
import type { GridBackend } from './backend'

const additive = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one',
  depthWriteEnabled: false,
  depthCompare: 'always',
} as const
const floats = (texture: Texture, z = 0): Float32Array => {
  const bytes = texture.readDataSyncWebGL({ z, depthOrArrayLayers: 1 })
  return bytes instanceof ArrayBuffer ? new Float32Array(bytes) : new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}
export async function createGridWebGL (
  canvas: HTMLCanvasElement, input: Input, p: Parameters, initial: Frame,
  wrapForce: (factory: WebGLForceFactory) => WebGLForceFactory = (factory): WebGLForceFactory => factory,
  maxSamples = initial.slots
): Promise<GridBackend> {
  let frame = initial
  if (!Number.isInteger(initial.slots) || initial.slots < 1 || !Number.isInteger(maxSamples) ||
    maxSamples < initial.slots || maxSamples > 64) throw new Error('Invalid WebGL sample capacity')
  let diagnose: NonNullable<GridBackend['diagnose']>
  let readStructure: () => Promise<Structure> = async () => { throw new Error('Grid not initialized') }
  const base = await createWebGL(canvas, input, p, wrapForce(({ device, positions, random, exit, target, count, size }) => {
    const owned: Array<{ destroy(): void }> = []
    const own = <T extends { destroy(): void }>(v: T): T => { owned.push(v); return v }
    try {
      const l = layout(count)
      const indices = new Float32Array(count * 2)
      for (let i = 0; i < count; i++) { indices[i * 2] = i % size; indices[i * 2 + 1] = Math.floor(i / size) }
      const points = own(device.createBuffer({ data: indices }))
      const quad = own(device.createBuffer({ data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }))
      const texture = (width: number, depth?: number): Texture => own(device.createTexture({
        width,
        height: width,
        format: 'rgba32float',
        dimension: depth ? '2d-array' : '2d',
        depth: depth ?? 1,
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_SRC | Texture.COPY_DST,
        sampler: { minFilter: 'nearest', magFilter: 'nearest' },
      }))
      const bounds = texture(1)
      const levels = l.sizes.map(n => texture(n))
      const levelTargets = levels.map((t, i) => own(device.createFramebuffer({ width: l.sizes[i], height: l.sizes[i], colorAttachments: [t] })))
      // RGBA keeps luma's portable WebGL readback path available; shaders only use RG.
      const arrays = [texture(l.finest, Math.ceil(maxSamples / 2)), texture(l.finest, Math.ceil(maxSamples / 2))]
      const depth = own(device.createTexture({ width: l.finest, height: l.finest, format: 'depth24plus', usage: Texture.RENDER }))
      const slots = Array.from({ length: maxSamples }, (_, s) => {
        const view = own(arrays[s % 2].createView({ dimension: '2d', baseArrayLayer: s >> 1, arrayLayerCount: 1, mipLevelCount: 1 }))
        return own(device.createFramebuffer({ width: l.finest, height: l.finest, colorAttachments: [view], depthStencilAttachment: depth }))
      })
      const model = (block: string, names: string[], vs: string, fs: string, pointList: boolean, peel = false): {
        model: Model; uniforms: UniformStore;
      } => {
        const uniformTypes = Object.fromEntries(names.map(name => [name, 'f32'])) as Record<string, 'f32'>
        const uniforms = own(new UniformStore(device, { [block]: { uniformTypes } }))
        const result = own(new Model(device, {
          vs,
          fs,
          defines: { USE_UNIFORM_BUFFERS: true },
          topology: pointList ? 'point-list' : 'triangle-strip',
          vertexCount: pointList ? count : 4,
          attributes: pointList ? { pointIndices: points } : { vertexCoord: quad },
          bufferLayout: [{ name: pointList ? 'pointIndices' : 'vertexCoord', format: 'float32x2' }],
          bindings: { [block]: uniforms.getManagedUniformBuffer(block) },
          parameters: peel ? { blend: false, depthWriteEnabled: true, depthCompare: 'less' } : additive,
        }))
        return { model: result, uniforms }
      }
      const aggregate = model('calculateLevelsPreciseUniforms', ['levelGridSize'], withGridCell(aggregateVert), aggregateFrag, true)
      const level = model('forceLevelPreciseUniforms',
        ['levelGridSize', 'isFirstLevel', 'alpha', 'repulsion', 'shellRadius', 'parentShellRadius'], quadVert, withGridCell(levelFrag), false)
      const near = model('forceNearFieldUniforms',
        ['pointsTextureSize', 'levelGridSize', 'maxStep', 'alpha', 'repulsion', 'slotCount'], quadVert, withGridCell(nearFrag), false)
      const peel = model('buildNearFieldSlotsUniforms',
        ['pointsTextureSize', 'levelGridSize', 'hasPreviousSlot', 'randomSeed', 'previousLayer'], withGridCell(slotsVert), slotsFrag, true, true)
      const configureLevel = (i: number, n: number): void => {
        level.uniforms.setUniforms({
          forceLevelPreciseUniforms: {
            levelGridSize: n,
            isFirstLevel: i === 0 ? 1 : 0,
            alpha: p.alpha,
            repulsion: p.repulsion,
            shellRadius: frame.precise && i < l.sizes.length - 1 ? 2 : 1,
            parentShellRadius: i === 0 ? 0 : frame.precise ? 2 : 1,
          },
        })
      }
      let lastSource = -1
      diagnose = async (): ReturnType<NonNullable<GridBackend['diagnose']>> => {
        if (lastSource < 0) throw new Error('Step before diagnosing')
        const temporary: Array<{ destroy(): void }> = []
        const keep = <T extends { destroy(): void }>(r: T): T => { temporary.push(r); return r }
        try {
          const scratch = keep(device.createTexture({ width: size, height: size, format: 'rgba32float', usage: Texture.RENDER | Texture.COPY_SRC }))
          const framebuffer = keep(device.createFramebuffer({ width: size, height: size, colorAttachments: [scratch] }))
          const common = { positionsTexture: positions[lastSource], dataBoundsTexture: bounds }
          const trace: Trace = {}
          const draw = (m: Model, clear: boolean): Float32Array => {
            const pass = device.beginRenderPass({ framebuffer, clearColor: clear ? [0, 0, 0, 0] : false, clearDepth: false })
            try { m.draw(pass) } finally { pass.end() }
            return floats(scratch).slice(0, count * 4)
          }
          for (const [i, n] of l.sizes.entries()) {
            configureLevel(i, n)
            level.model.setBindings({ ...common, levelTexture: levels[i] })
            trace[`far ${n}`] = draw(level.model, i === 0)
          }
          const nearBindings = { ...common, levelTexture: levels[levels.length - 1], randomValues: random, slotsEven: arrays[0], slotsOdd: arrays[1] }
          near.model.setBindings(nearBindings)
          const forces = draw(near.model, false)
          for (const stage of ['raw', 'jitter'] as const) {
            const m = keep(new Model(device, {
              vs: quadVert,
              fs: withGridCell(nearTraceShader(nearFrag, stage)),
              defines: { USE_UNIFORM_BUFFERS: true },
              topology: 'triangle-strip',
              vertexCount: 4,
              attributes: { vertexCoord: quad },
              bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
              bindings: { ...nearBindings, forceNearFieldUniforms: near.uniforms.getManagedUniformBuffer('forceNearFieldUniforms') },
              parameters: { ...additive, blend: false },
            }))
            trace[`near ${stage}`] = draw(m, true)
          }
          trace['near clamped'] = draw(near.model, true)
          return { trace, forces }
        } finally { temporary.reverse().forEach(r => r.destroy()) }
      }
      readStructure = async (): Promise<Structure> => {
        const aggregates = new Float32Array(l.cells * 4)
        levels.forEach((t, i) => aggregates.set(floats(t), l.offsets[i] * 4))
        const result = new Float32Array(l.finest ** 2 * frame.slots * 2)
        for (let s = 0; s < frame.slots; s++) {
          const data = floats(arrays[s % 2], s >> 1)
          for (let c = 0; c < l.finest ** 2; c++) result.set(data.subarray(c * 4, c * 4 + 2), (s * l.finest ** 2 + c) * 2)
        }
        return { aggregates, slots: result }
      }
      return {
        encode (source): void {
          lastSource = source
          bounds.copyImageData({ data: frame.bounds, bytesPerRow: 16 })
          const common = { positionsTexture: positions[source], dataBoundsTexture: bounds }
          for (const [i, n] of l.sizes.entries()) {
            aggregate.uniforms.setUniforms({ calculateLevelsPreciseUniforms: { levelGridSize: n } })
            aggregate.model.setBindings({ ...common, exitTexture: exit })
            const pass = device.beginRenderPass({ framebuffer: levelTargets[i], clearColor: [0, 0, 0, 0], clearDepth: false })
            try { aggregate.model.draw(pass) } finally { pass.end() }
          }
          for (let s = 0; s < frame.slots; s++) {
            peel.uniforms.setUniforms({
              buildNearFieldSlotsUniforms: {
                pointsTextureSize: size, levelGridSize: l.finest, hasPreviousSlot: s ? 1 : 0, randomSeed: frame.seed, previousLayer: Math.max(0, s - 1) >> 1,
              },
            })
            peel.model.setBindings({ ...common, exitTexture: exit, previousSlot: arrays[(s + 1) % 2] })
            const pass = device.beginRenderPass({ framebuffer: slots[s], clearColor: [-1, 1, 0, 0], clearDepth: 1 })
            try { peel.model.draw(pass) } finally { pass.end() }
          }
          const pass = device.beginRenderPass({ framebuffer: target, clearColor: [0, 0, 0, 0], clearDepth: false })
          try {
            for (const [i, n] of l.sizes.entries()) {
              configureLevel(i, n)
              level.model.setBindings({ ...common, levelTexture: levels[i] }); level.model.draw(pass)
            }
            near.uniforms.setUniforms({
              forceNearFieldUniforms: {
                pointsTextureSize: size, levelGridSize: l.finest, maxStep: nearLimit(count, p), alpha: p.alpha, repulsion: p.repulsion, slotCount: frame.slots,
              },
            })
            near.model.setBindings({ ...common, levelTexture: levels[levels.length - 1], randomValues: random, slotsEven: arrays[0], slotsOdd: arrays[1] })
            near.model.draw(pass)
          } finally { pass.end() }
        },
        destroy (): void { owned.reverse().forEach(resource => resource.destroy()) },
      }
    } catch (error) { owned.reverse().forEach(resource => resource.destroy()); throw error }
  }))
  return {
    ...base,
    name: 'WebGL grid',
    diagnose: () => diagnose(),
    readStructure: () => readStructure(),
    setSampling (samples): void {
      if (!Number.isInteger(samples) || samples < 1 || samples > maxSamples) throw new Error('WebGL sample count exceeds capacity')
      frame = { ...frame, slots: samples }
    },
    setFrame (next): void {
      if (!Number.isInteger(next.slots) || next.slots < 1 || next.slots > maxSamples) throw new Error('WebGL sample count exceeds capacity')
      frame = next
    },
  }
}
