import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, createDevice, createStorageRenderer, readFloats, upload } from '../../../gpu/luma'
import type { BackendResult, CenterMassBackend } from '../backend'
import drawCenterShader from './shaders/draw-center.wgsl?raw'
import drawShader from './shaders/draw.wgsl?raw'
import reducePartialsShader from './shaders/reduce-partials.wgsl?raw'
import reducePointsShader from './shaders/reduce-points.wgsl?raw'

export async function createWebGPUCenterMass (canvas: HTMLCanvasElement, pointCount: number): Promise<CenterMassBackend> {
  const partialCount = Math.ceil(pointCount / 256)
  if (partialCount > 256) throw new Error('Point count exceeds this two-stage experiment’s 65536 limit')
  const device = await createDevice('webgpu', canvas)
  const positions = device.createBuffer({ byteLength: pointCount * 8, usage: Buffer.STORAGE | Buffer.COPY_DST })
  const partials = device.createBuffer({ byteLength: partialCount * 16, usage: Buffer.STORAGE })
  const result = device.createBuffer({ byteLength: 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })
  const pointParams = upload(device, new Uint32Array([pointCount, 0, 0, 0]), Buffer.UNIFORM)
  const partialParams = upload(device, new Uint32Array([partialCount, 0, 0, 0]), Buffer.UNIFORM)
  const uniforms = upload(device, new Float32Array(4), Buffer.UNIFORM)
  const reducePoints = new Kernel(device, {
    source: reducePointsShader,
    shaderLayout: {
      bindings: bindingLayout([
        ['positions', 'read-only-storage'], ['partials', 'storage'], ['parameters', 'uniform'],
      ]),
    },
  })
  const reducePartials = new Kernel(device, {
    source: reducePartialsShader,
    shaderLayout: {
      bindings: bindingLayout([
        ['partials', 'read-only-storage'], ['result', 'storage'], ['parameters', 'uniform'],
      ]),
    },
  })
  const points = createStorageRenderer(device, drawShader, 'point-list', bindingLayout([['positions', 'read-only-storage']]))
  const marker = createStorageRenderer(device, drawCenterShader, 'triangle-list', bindingLayout([['uniforms', 'uniform']]))
  return {
    label: 'WebGPU · luma two-stage f32 reduction',
    async run (data: Float32Array): Promise<BackendResult> {
      const start = performance.now(); positions.write(data)
      const compute = device.beginComputePass()
      reducePoints.dispatch(compute, { x: partialCount, bindings: { positions, partials, parameters: pointParams } })
      reducePartials.dispatch(compute, { x: 1, bindings: { partials, result, parameters: partialParams } })
      compute.end(); device.submit()
      const values = await readFloats(result)
      const center = { x: values[0] / values[2], y: values[1] / values[2], count: values[2] }
      uniforms.write(new Float32Array([center.x, center.y, 2 / canvas.width, 2 / canvas.height]))
      const pass = device.beginRenderPass({ clearColor: [0.09, 0.1, 0.12, 1], clearDepth: false })
      points.kernel.draw(pass, { vertexArray: points.vertexArray, vertexCount: pointCount, bindings: { positions } })
      marker.kernel.draw(pass, { vertexArray: marker.vertexArray, vertexCount: 6, bindings: { uniforms } })
      pass.end(); device.submit()
      return { center, elapsedMilliseconds: performance.now() - start }
    },
    destroy (): void {
      points.destroy(); marker.destroy(); reducePoints.destroy(); reducePartials.destroy()
      for (const buffer of [positions, partials, result, pointParams, partialParams, uniforms]) buffer.destroy()
      device.destroy()
    },
  }
}
