import { Buffer, UniformStore, type ComputePass } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import forceFrag from '../../../../../src/modules/ForceMouse/force-mouse.frag?raw'
import quadVert from '../../../../../src/modules/Shared/quad.vert?raw'
import { upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { describeEnvironment } from '../../gpu/force-preview'
import type { Backend } from '../many-body/backend'
import type { Input } from '../many-body/data'
import { measureBatch, timestamps, type Measurement, type TimestampWrites } from '../many-body/timing'
import { createWebGL } from '../many-body/webgl'
import { createWebGPU } from '../many-body/webgpu'
import { pointerRepulsionActive, pointerUniform, SETTINGS, type MouseGate, type Vector } from './data'
import { createMouseWebGPU } from './webgpu'

export type Api = 'webgl' | 'webgpu'
export type MouseBackend = Backend & {
  setPointer(world: Vector, strength: number): void;
  stepWhenHeld(state: MouseGate): boolean;
  measureForce(operations: number): Promise<Measurement>;
  environment(): ReturnType<typeof describeEnvironment>;
}

export async function createBackend (api: Api, canvas: HTMLCanvasElement, input: Input): Promise<MouseBackend> {
  let setPointer!: MouseBackend['setPointer']
  let measureForce!: MouseBackend['measureForce']
  let environment!: MouseBackend['environment']
  const base = api === 'webgl'
    ? await createWebGL(canvas, input, SETTINGS, ({ device, positions, target }) => {
      const scope = resourceScope()
      try {
        const quad = scope.own(upload(device, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), Buffer.VERTEX))
        const uniforms = scope.own(new UniformStore(device, {
          forceMouseUniforms: { uniformTypes: { repulsion: 'f32', mousePos: 'vec2<f32>' } },
        }))
        const force = scope.own(new Model(device, {
          vs: quadVert,
          fs: forceFrag,
          defines: { USE_UNIFORM_BUFFERS: true },
          topology: 'triangle-strip',
          vertexCount: 4,
          attributes: { vertexCoord: quad },
          bufferLayout: [{ name: 'vertexCoord', format: 'float32x2' }],
          bindings: { forceMouseUniforms: uniforms.getManagedUniformBuffer('forceMouseUniforms') },
          parameters: { depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none', blend: false },
        }))
        setPointer = (world, strength): void => {
          const [x, y, repulsion] = pointerUniform(world, strength)
          const mousePos: [number, number] = [x, y]
          uniforms.setUniforms({ forceMouseUniforms: { repulsion, mousePos } })
        }
        const encode = (source: number): void => {
          force.setBindings({ positionsTexture: positions[source] })
          const pass = device.beginRenderPass({ framebuffer: target, clearColor: [0, 0, 0, 0], clearDepth: false })
          try { force.draw(pass) } finally { pass.end() }
        }
        measureForce = (operations): Promise<Measurement> => measureBatch(device, operations, () => encode(0))
        environment = (): ReturnType<MouseBackend['environment']> => describeEnvironment(device, canvas)
        return { encode, destroy: scope.destroy }
      } catch (error) { scope.destroy(); throw error }
    })
    : await createWebGPU(canvas, input, SETTINGS, 'direct', async ({ device, positions, forces, count }) => {
      const force = await createMouseWebGPU(device, forces)
      setPointer = (world, strength): void => { force.prepare(count, world, strength) }
      const encode = (source: number, timing: TimestampWrites, shared?: ComputePass): void => {
        const pass = shared ?? device.beginComputePass(timing)
        try { force.encode(pass, positions[source]) } finally { if (!shared) pass.end() }
      }
      measureForce = (operations): Promise<Measurement> => measureBatch(device, operations, (query, first, last) => encode(0, timestamps(query, first, last)))
      environment = (): ReturnType<MouseBackend['environment']> => describeEnvironment(device, canvas)
      return { encode, destroy: force.destroy }
    })
  try {
    setPointer([0, 0], 0)
    return {
      ...base,
      info: api === 'webgl' ? base.info : `${environment().device.vendor} ${environment().device.gpuArchitecture}; luma Kernel / RenderKernel`,
      setPointer,
      stepWhenHeld (state): boolean {
        if (!pointerRepulsionActive(state)) return false
        base.step()
        return true
      },
      measureForce,
      environment,
    }
  } catch (error) { base.destroy(); throw error }
}
