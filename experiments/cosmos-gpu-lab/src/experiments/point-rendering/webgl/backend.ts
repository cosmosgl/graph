import { Buffer, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { ALPHA_BLEND, createDevice, waitForGpu } from '../../../gpu/luma'
import type { PointRenderBackend, PointRenderData, PointRenderMeasurement } from '../backend'
import fragmentShader from './shaders/circle.frag.glsl?raw'
import vertexShader from './shaders/circle.vert.glsl?raw'

export async function createWebGLPointRenderer (canvas: HTMLCanvasElement): Promise<PointRenderBackend> {
  const device = await createDevice('webgl', canvas)
  const uniforms = new UniformStore(device, { pointUniforms: { uniformTypes: { pointDiameter: 'f32' } } })
  let positions: Buffer | undefined; let colors: Buffer | undefined
  const model = new Model(device, {
    vs: vertexShader,
    fs: fragmentShader,
    topology: 'point-list',
    vertexCount: 0,
    bufferLayout: [{ name: 'position', format: 'float32x2' }, { name: 'color', format: 'float32x4' }],
    bindings: { pointUniforms: uniforms.getManagedUniformBuffer('pointUniforms') },
    parameters: { ...ALPHA_BLEND, depthWriteEnabled: false, depthCompare: 'always' },
  })
  const draw = (diameter: number, iterations = 1): void => {
    uniforms.setUniforms({ pointUniforms: { pointDiameter: diameter } })
    const pass = device.beginRenderPass({ clearColor: [0.075, 0.087, 0.105, 1], clearDepth: false })
    for (let i = 0; i < iterations; i++) model.draw(pass)
    pass.end(); device.submit()
  }
  return {
    setData (data: PointRenderData): void {
      positions?.destroy(); colors?.destroy()
      positions = device.createBuffer({ data: data.positions, usage: Buffer.VERTEX | Buffer.COPY_DST })
      colors = device.createBuffer({ data: data.colors, usage: Buffer.VERTEX | Buffer.COPY_DST })
      model.setAttributes({ position: positions, color: colors }); model.setVertexCount(data.count)
    },
    render: draw,
    async measure (diameter: number, iterations = 1): Promise<PointRenderMeasurement> {
      const start = performance.now(); draw(diameter, iterations); const submitted = performance.now()
      await waitForGpu(device)
      return { submitMilliseconds: submitted - start, completionMilliseconds: performance.now() - start }
    },
    destroy (): void { model.destroy(); uniforms.destroy(); positions?.destroy(); colors?.destroy(); device.destroy() },
  }
}
