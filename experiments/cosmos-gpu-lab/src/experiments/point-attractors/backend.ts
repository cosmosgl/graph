import { Buffer, Texture, UniformStore, type ComputePass } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { bindingLayout, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { describeEnvironment } from '../../gpu/force-preview'
import { createRoundedKernel, roundedIntegrationSource } from '../combined-layout/spring-precision'
import { createWebGL } from '../many-body/webgl'
import { createWebGPU } from '../many-body/webgpu'
import type { Snapshot } from '../many-body/reference'
import type { Backend } from '../many-body/backend'
import { measureBatch, timestamps, type Measurement, type TimestampWrites } from '../many-body/timing'
import forceFrag from '../../../../../src/modules/ForceAttractor/force-attractor.frag?raw'
import quadVert from '../../../../../src/modules/Shared/quad.vert?raw'
import { SETTINGS, packAttractors, validate, type AttractorInput } from './data'
import { createAttractorWebGPU } from './webgpu'
export type Api = 'webgl' | 'webgpu'
export type AttractorBackend = Backend & {
  updateAttractors(input: AttractorInput): void;
  measureForce(operations: number): Promise<Measurement>;
  environment(): ReturnType<typeof describeEnvironment>;
}
export async function createBackend (api: Api, canvas: HTMLCanvasElement, input: AttractorInput, settings = SETTINGS): Promise<AttractorBackend> {
  validate(input, settings)
  const count = input.points.length / 4
  let active = false
  let update!: (values: Float32Array) => void; let measure!: AttractorBackend['measureForce']; let environment!: AttractorBackend['environment']
  const base = api === 'webgl'
    ? await createWebGL(canvas, input, settings, ({ device, positions, target, size }) => {
      const scope = resourceScope(); const own = scope.own
      try {
        const attractors = own(device.createTexture({
          width: size,
          height: size,
          format: 'rgba32float',
          usage: Texture.SAMPLE | Texture.COPY_DST,
          sampler: { minFilter: 'nearest', magFilter: 'nearest' },
        }))
        const uniforms = own(new UniformStore(device, {
          forceAttractorUniforms: { uniformTypes: { alpha: 'f32', attractorCoefficient: 'f32' } },
        }))
        const quad = own(upload(device, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), Buffer.VERTEX))
        const force = own(new Model(device, {
          vs: quadVert,
          fs: forceFrag,
          defines: { USE_UNIFORM_BUFFERS: true },
          topology: 'triangle-strip',
          vertexCount: 4,
          attributes: { vertexCoord: quad },
          bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
          bindings: { forceAttractorUniforms: uniforms.getManagedUniformBuffer('forceAttractorUniforms'), attractorTexture: attractors },
          parameters: { depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none', blend: false },
        }))
        uniforms.setUniforms({ forceAttractorUniforms: { alpha: settings.alpha, attractorCoefficient: settings.strength } })
        update = (values): void => {
          const padded = new Float32Array(size * size * 4); padded.set(values)
          attractors.copyImageData({ data: padded, bytesPerRow: size * 16, mipLevel: 0, x: 0, y: 0 })
        }
        const encode = (source: number): void => {
          force.setBindings({ positionsTexture: positions[source] })
          const pass = device.beginRenderPass({ framebuffer: target, clearColor: [0, 0, 0, 0], clearDepth: false })
          try { force.draw(pass) } finally { pass.end() }
        }
        measure = (operations): Promise<Measurement> => measureBatch(device, operations, () => encode(0))
        environment = (): ReturnType<AttractorBackend['environment']> => describeEnvironment(device, canvas)
        return { encode, destroy: scope.destroy }
      } catch (error) { scope.destroy(); throw error }
    })
    : await createWebGPU(canvas, input, settings, 'direct', async ({ device, positions, forces }) => {
      const scope = resourceScope(); const own = scope.own
      try {
        const attractor = own(await createAttractorWebGPU(device, count, forces))
        attractor.prepare(settings.alpha, settings.strength)
        const integrationParams = own(upload(device, new Float32Array([count, 0, 0, 0, settings.friction, settings.referenceLength, 0, 0]), Buffer.UNIFORM))
        const integrate = own(await createRoundedKernel(device, roundedIntegrationSource(), bindingLayout([
          ['positions', 'read-only-storage'], ['forces', 'read-only-storage'], ['params', 'uniform'], ['output', 'storage'],
        ])))
        update = attractor.update
        const encode = (source: number, timing: TimestampWrites, shared?: ComputePass): void => {
          const pass = shared ?? device.beginComputePass(timing)
          try { attractor.encode(pass, positions[source]) } finally { if (!shared) pass.end() }
        }
        measure = (operations): Promise<Measurement> => measureBatch(device, operations, (query, first, last) => encode(0, timestamps(query, first, last)))
        environment = (): ReturnType<AttractorBackend['environment']> => describeEnvironment(device, canvas)
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
  try {
    const uploadTargets = (next: AttractorInput): void => {
      validate(next, settings)
      if (next.points.length !== count * 4) throw new Error('Count changes require data replacement')
      const packed = packAttractors(next); update(packed.values); active = packed.active
    }
    uploadTargets(input)
    const device = environment().device
    return {
      ...base,
      info: api === 'webgl' ? base.info : `${device.vendor} ${device.gpuArchitecture}; fallback ${device.fallback}; luma Computation / RenderKernel; 64 invocations per workgroup`,
      // No target means production skips force AND integration. No GPU work is submitted.
      step (timing): void { if (active) base.step(timing) },
      async read (): Promise<Snapshot> { const result = await base.read(); return active ? result : { ...result, forces: new Float32Array(count * 4) } },
      updateAttractors: uploadTargets,
      measureForce (operations): Promise<Measurement> {
        if (!active) throw new Error('Inactive attractors: no force pass to time')
        return measure(operations)
      },
      environment,
    }
  } catch (error) { base.destroy(); throw error }
}
