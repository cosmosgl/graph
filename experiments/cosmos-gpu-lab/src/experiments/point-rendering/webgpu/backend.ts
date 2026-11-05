import { luma } from '@luma.gl/core'
import { webgpuAdapter, type WebGPUDevice } from '@luma.gl/webgpu'
import type { PointRenderBackend, PointRenderData } from '../backend'
import { MAX_POINT_COUNT } from '../point-data'
import shaderSource from './shaders/circle.wgsl?raw'

const BUFFER_USAGE = {
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const

export async function createWebGPUPointRenderer (
  canvas: HTMLCanvasElement
): Promise<PointRenderBackend> {
  const lumaDevice = await luma.createDevice({
    id: 'point-rendering-webgpu',
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    featureLevel: 'core',
    createCanvasContext: {
      canvas,
      autoResize: false,
      useDevicePixels: false,
      alphaMode: 'opaque',
    },
  }) as WebGPUDevice

  const device = lumaDevice.handle
  const context = lumaDevice.canvasContext?.handle
  const format = lumaDevice.canvasContext?.colorFormat
  if (!context || !format) {
    lumaDevice.destroy()
    throw new Error('luma.gl did not create a WebGPU canvas context')
  }

  const positionBuffer = device.createBuffer({
    label: 'point positions',
    size: MAX_POINT_COUNT * 2 * Float32Array.BYTES_PER_ELEMENT,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.STORAGE,
  })
  const colorBuffer = device.createBuffer({
    label: 'point colors',
    size: MAX_POINT_COUNT * 4 * Float32Array.BYTES_PER_ELEMENT,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.STORAGE,
  })
  const uniformBuffer = device.createBuffer({
    label: 'point render uniforms',
    size: 4 * Float32Array.BYTES_PER_ELEMENT,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.UNIFORM,
  })
  const module = device.createShaderModule({ label: 'circle point shader', code: shaderSource })
  const pipeline = device.createRenderPipeline({
    label: 'instanced circle points',
    layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [{
        format,
        blend: {
          color: {
            operation: 'add',
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha',
          },
          alpha: {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
          },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  })
  const bindings = device.createBindGroup({
    label: 'point render bindings',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: colorBuffer } },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  })
  let count = 0

  return {
    setData (data: PointRenderData): void {
      count = data.count
      device.queue.writeBuffer(
        positionBuffer,
        0,
        data.positions.buffer as ArrayBuffer,
        data.positions.byteOffset,
        data.positions.byteLength
      )
      device.queue.writeBuffer(
        colorBuffer,
        0,
        data.colors.buffer as ArrayBuffer,
        data.colors.byteOffset,
        data.colors.byteLength
      )
    },
    render (diameter: number): void {
      device.queue.writeBuffer(
        uniformBuffer,
        0,
        new Float32Array([diameter, canvas.width, canvas.height, 0])
      )
      const encoder = device.createCommandEncoder({ label: 'render circle points' })
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.075, g: 0.087, b: 0.105, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindings)
      pass.draw(6, count)
      pass.end()
      device.queue.submit([encoder.finish()])
    },
    destroy (): void {
      uniformBuffer.destroy()
      colorBuffer.destroy()
      positionBuffer.destroy()
      lumaDevice.destroy()
    },
  }
}
