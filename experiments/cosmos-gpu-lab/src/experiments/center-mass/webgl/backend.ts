import { Buffer, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { createDevice } from '../../../gpu/luma'
import type { BackendResult, CenterMassBackend } from '../backend'
import { createBlendReduction } from './reduction'
import fs from './shaders/draw.frag.glsl?raw'
import vs from './shaders/draw.vert.glsl?raw'

export async function createWebGLCenterMass (canvas: HTMLCanvasElement, pointCount: number): Promise<CenterMassBackend> {
  const device = await createDevice('webgl', canvas)
  try {
    const reduction = createBlendReduction(device, pointCount)
    const uniforms = new UniformStore(device, { drawUniforms: { uniformTypes: { pointSize: 'f32', color: 'vec4<f32>' } } })
    const marker = device.createBuffer({ byteLength: 8, usage: Buffer.VERTEX | Buffer.COPY_DST })
    const model = new Model(device, {
      vs,
      fs,
      topology: 'point-list',
      vertexCount: pointCount,
      bufferLayout: [{ name: 'position', format: 'float32x2' }],
      bindings: { drawUniforms: uniforms.getManagedUniformBuffer('drawUniforms') },
      parameters: { depthWriteEnabled: false, depthCompare: 'always' },
    })
    return {
      label: 'WebGL2 · luma additive RGBA32F blend',
      async run (positions: Float32Array): Promise<BackendResult> {
        const start = performance.now()
        reduction.positions.write(positions); reduction.encode(); device.submit()
        const values = reduction.read()
        const center = { x: values[0] / values[2], y: values[1] / values[2], count: values[2] }
        marker.write(new Float32Array([center.x, center.y]))
        const pass = device.beginRenderPass({ clearColor: [0.09, 0.1, 0.12, 1], clearDepth: false })
        model.setAttributes({ position: reduction.positions }); model.setVertexCount(pointCount)
        uniforms.setUniforms({ drawUniforms: { pointSize: 1, color: [0.76, 0.82, 0.91, 0.88] } }); model.draw(pass)
        model.setAttributes({ position: marker }); model.setVertexCount(1)
        uniforms.setUniforms({ drawUniforms: { pointSize: 9, color: [1, 0.32, 0.24, 1] } }); model.draw(pass)
        pass.end(); device.submit()
        return { center, elapsedMilliseconds: performance.now() - start }
      },
      destroy (): void { model.destroy(); uniforms.destroy(); marker.destroy(); reduction.destroy(); device.destroy() },
    }
  } catch (error) { device.destroy(); throw error }
}
