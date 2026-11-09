import { Buffer, Texture, type Device } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import fs from './shaders/center.frag.glsl?raw'
import vs from './shaders/center.vert.glsl?raw'

export function createBlendReduction (device: Device, count: number): {
  positions: Buffer; encode(iterations?: number): void; read(): Float32Array; destroy(): void;
} {
  const capabilities = device.getTextureFormatCapabilities('rgba32float')
  if (!capabilities.render || !capabilities.blend) throw new Error('RGBA32F rendering and float blending are required')
  const positions = device.createBuffer({ byteLength: count * 8, usage: Buffer.VERTEX | Buffer.COPY_DST })
  const texture = device.createTexture({ width: 1, height: 1, format: 'rgba32float', usage: Texture.RENDER | Texture.COPY_SRC })
  const framebuffer = device.createFramebuffer({ width: 1, height: 1, colorAttachments: [texture] })
  const model = new Model(device, {
    vs,
    fs,
    topology: 'point-list',
    vertexCount: count,
    attributes: { position: positions },
    bufferLayout: [{ name: 'position', format: 'float32x2' }],
    parameters: {
      blend: true,
      blendColorSrcFactor: 'one',
      blendColorDstFactor: 'one',
      blendAlphaSrcFactor: 'one',
      blendAlphaDstFactor: 'one',
      blendColorOperation: 'add',
      blendAlphaOperation: 'add',
      depthWriteEnabled: false,
      depthCompare: 'always',
    },
  })
  return {
    positions,
    encode (iterations = 1): void {
      const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false })
      for (let i = 0; i < iterations; i++) model.draw(pass)
      pass.end()
    },
    read (): Float32Array { return device.readPixelsToArrayWebGL(framebuffer) as Float32Array },
    destroy (): void { model.destroy(); framebuffer.destroy(); texture.destroy(); positions.destroy() },
  }
}
