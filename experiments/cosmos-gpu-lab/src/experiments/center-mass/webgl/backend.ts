import { Buffer, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { describeDevice, createDevice } from '../../../gpu/luma'
import { graphRgba } from '../../../runtime/palette'
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
      info: describeDevice(device),
      label: 'WebGL2 · luma additive RGBA32F blend',
      async run (positions: Float32Array): Promise<BackendResult> {
        const start = performance.now()
        reduction.positions.write(positions); reduction.encode(); device.submit()
        const values = reduction.read()
        const center = { x: values[0] / values[2], y: values[1] / values[2], count: values[2] }
        marker.write(new Float32Array([center.x, center.y]))
        const pass = device.beginRenderPass({ clearColor: graphRgba.background, clearDepth: false })
        model.setAttributes({ position: reduction.positions }); model.setVertexCount(pointCount)
        uniforms.setUniforms({ drawUniforms: { pointSize: 1, color: [...graphRgba.point.slice(0, 3), 0.88] } }); model.draw(pass)
        model.setAttributes({ position: marker }); model.setVertexCount(1)
        uniforms.setUniforms({ drawUniforms: { pointSize: 9, color: graphRgba.pinned } }); model.draw(pass)
        pass.end(); device.submit()
        return { center, elapsedMilliseconds: performance.now() - start }
      },
      destroy (): void { model.destroy(); uniforms.destroy(); marker.destroy(); reduction.destroy(); device.destroy() },
    }
  } catch (error) { device.destroy(); throw error }
}
