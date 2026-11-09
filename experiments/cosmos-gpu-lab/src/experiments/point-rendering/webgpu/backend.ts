import { Buffer } from '@luma.gl/core'
import { ALPHA_BLEND, bindingLayout, createDevice, createStorageRenderer, waitForGpu } from '../../../gpu/luma'
import type { PointRenderBackend, PointRenderData, PointRenderMeasurement } from '../backend'
import { MAX_POINT_COUNT } from '../point-data'
import source from './shaders/circle.wgsl?raw'

export async function createWebGPUPointRenderer (canvas: HTMLCanvasElement, capacity: number = MAX_POINT_COUNT): Promise<PointRenderBackend> {
  const device = await createDevice('webgpu', canvas)
  const positions = device.createBuffer({ byteLength: capacity * 8, usage: Buffer.STORAGE | Buffer.COPY_DST })
  const colors = device.createBuffer({ byteLength: capacity * 16, usage: Buffer.STORAGE | Buffer.COPY_DST })
  const uniforms = device.createBuffer({ byteLength: 16, usage: Buffer.UNIFORM | Buffer.COPY_DST })
  const renderer = createStorageRenderer(device, source, 'triangle-list', bindingLayout([
    ['positions', 'read-only-storage'], ['colors', 'read-only-storage'], ['uniforms', 'uniform'],
  ]), ALPHA_BLEND)
  let count = 0
  const draw = (diameter: number, iterations = 1): void => {
    uniforms.write(new Float32Array([diameter, canvas.width, canvas.height, 0]))
    const pass = device.beginRenderPass({ clearColor: [0.075, 0.087, 0.105, 1], clearDepth: false })
    for (let i = 0; i < iterations; i++) {
      renderer.kernel.draw(pass, {
        vertexArray: renderer.vertexArray, vertexCount: 6, instanceCount: count, bindings: { positions, colors, uniforms },
      })
    }
    pass.end(); device.submit()
  }
  return {
    setData (data: PointRenderData): void {
      if (data.count > capacity) throw new Error('Point data exceeds renderer capacity')
      count = data.count; positions.write(data.positions); colors.write(data.colors)
    },
    render: draw,
    async measure (diameter: number, iterations = 1): Promise<PointRenderMeasurement> {
      const start = performance.now(); draw(diameter, iterations); const submitted = performance.now()
      await waitForGpu(device)
      return { submitMilliseconds: submitted - start, completionMilliseconds: performance.now() - start }
    },
    destroy (): void { renderer.destroy(); uniforms.destroy(); colors.destroy(); positions.destroy(); device.destroy() },
  }
}
