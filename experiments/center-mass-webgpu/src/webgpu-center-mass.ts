import { luma } from '@luma.gl/core'
import { webgpuAdapter, type WebGPUDevice } from '@luma.gl/webgpu'
import type { BackendResult, CenterMassBackend } from './backend'
import {
  WEBGPU_DRAW,
  WEBGPU_DRAW_CENTER,
  WEBGPU_REDUCE_PARTIALS,
  WEBGPU_REDUCE_POINTS,
} from './shaders'

const WORKGROUP_SIZE = 256
const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const
const MAP_MODE_READ = 0x0001

export async function createWebGPUCenterMass (
  canvas: HTMLCanvasElement,
  pointCount: number
): Promise<CenterMassBackend> {
  const lumaDevice = await luma.createDevice({
    id: 'center-mass-webgpu',
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

  const partialCount = Math.ceil(pointCount / WORKGROUP_SIZE)
  if (partialCount > WORKGROUP_SIZE) {
    lumaDevice.destroy()
    throw new Error(`Point count exceeds this two-stage experiment's ${WORKGROUP_SIZE ** 2} limit`)
  }

  const positionBuffer = device.createBuffer({
    label: 'positions',
    size: pointCount * 2 * Float32Array.BYTES_PER_ELEMENT,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.STORAGE | BUFFER_USAGE.VERTEX,
  })
  const partialBuffer = device.createBuffer({
    label: 'center partial sums',
    size: partialCount * 4 * Float32Array.BYTES_PER_ELEMENT,
    usage: BUFFER_USAGE.STORAGE,
  })
  const resultBuffer = device.createBuffer({
    label: 'center result',
    size: 4 * Float32Array.BYTES_PER_ELEMENT,
    usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC,
  })
  const readbackBuffer = device.createBuffer({
    label: 'center readback',
    size: 4 * Float32Array.BYTES_PER_ELEMENT,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
  })
  const pointParameters = device.createBuffer({
    label: 'point reduction parameters',
    size: 16,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.UNIFORM,
  })
  const partialParameters = device.createBuffer({
    label: 'partial reduction parameters',
    size: 16,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.UNIFORM,
  })
  const centerUniforms = device.createBuffer({
    label: 'center drawing uniforms',
    size: 16,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.UNIFORM,
  })

  device.queue.writeBuffer(pointParameters, 0, new Uint32Array([pointCount, 0, 0, 0]))
  device.queue.writeBuffer(partialParameters, 0, new Uint32Array([partialCount, 0, 0, 0]))

  const pointReductionPipeline = device.createComputePipeline({
    label: 'reduce points',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: WEBGPU_REDUCE_POINTS }),
      entryPoint: 'main',
    },
  })
  const partialReductionPipeline = device.createComputePipeline({
    label: 'reduce partials',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: WEBGPU_REDUCE_PARTIALS }),
      entryPoint: 'main',
    },
  })
  const pointReductionBindings = device.createBindGroup({
    label: 'point reduction bindings',
    layout: pointReductionPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: partialBuffer } },
      { binding: 2, resource: { buffer: pointParameters } },
    ],
  })
  const partialReductionBindings = device.createBindGroup({
    label: 'partial reduction bindings',
    layout: partialReductionPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: partialBuffer } },
      { binding: 1, resource: { buffer: resultBuffer } },
      { binding: 2, resource: { buffer: partialParameters } },
    ],
  })

  const drawModule = device.createShaderModule({ code: WEBGPU_DRAW })
  const drawPipeline = device.createRenderPipeline({
    label: 'draw points',
    layout: 'auto',
    vertex: {
      module: drawModule,
      entryPoint: 'vertexMain',
      buffers: [{
        arrayStride: 8,
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
      }],
    },
    fragment: {
      module: drawModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: { topology: 'point-list' },
  })

  const centerModule = device.createShaderModule({ code: WEBGPU_DRAW_CENTER })
  const centerPipeline = device.createRenderPipeline({
    label: 'draw center',
    layout: 'auto',
    vertex: { module: centerModule, entryPoint: 'vertexMain' },
    fragment: {
      module: centerModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  })
  const centerBindings = device.createBindGroup({
    label: 'center drawing bindings',
    layout: centerPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: centerUniforms } }],
  })

  const render = (centerX: number, centerY: number): void => {
    device.queue.writeBuffer(
      centerUniforms,
      0,
      new Float32Array([centerX, centerY, 2 / canvas.width, 2 / canvas.height])
    )
    const encoder = device.createCommandEncoder({ label: 'render points and center' })
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.025, g: 0.035, b: 0.055, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    renderPass.setPipeline(drawPipeline)
    renderPass.setVertexBuffer(0, positionBuffer)
    renderPass.draw(pointCount)
    renderPass.setPipeline(centerPipeline)
    renderPass.setBindGroup(0, centerBindings)
    renderPass.draw(6)
    renderPass.end()
    device.queue.submit([encoder.finish()])
  }

  return {
    label: 'WebGPU · two-stage f32 reduction',
    async run (positions: Float32Array): Promise<BackendResult> {
      const started = performance.now()
      device.queue.writeBuffer(
        positionBuffer,
        0,
        positions.buffer as ArrayBuffer,
        positions.byteOffset,
        positions.byteLength
      )

      const encoder = device.createCommandEncoder({ label: 'calculate center mass' })
      const computePass = encoder.beginComputePass()
      computePass.setPipeline(pointReductionPipeline)
      computePass.setBindGroup(0, pointReductionBindings)
      computePass.dispatchWorkgroups(partialCount)
      computePass.setPipeline(partialReductionPipeline)
      computePass.setBindGroup(0, partialReductionBindings)
      computePass.dispatchWorkgroups(1)
      computePass.end()
      encoder.copyBufferToBuffer(resultBuffer, 0, readbackBuffer, 0, 16)
      device.queue.submit([encoder.finish()])

      await readbackBuffer.mapAsync(MAP_MODE_READ)
      const values = new Float32Array(readbackBuffer.getMappedRange()).slice()
      readbackBuffer.unmap()

      const count = values[2]
      const center = {
        x: values[0] / count,
        y: values[1] / count,
        count,
      }
      render(center.x, center.y)

      return {
        center,
        elapsedMilliseconds: performance.now() - started,
      }
    },
    destroy (): void {
      centerUniforms.destroy()
      partialParameters.destroy()
      pointParameters.destroy()
      readbackBuffer.destroy()
      resultBuffer.destroy()
      partialBuffer.destroy()
      positionBuffer.destroy()
      lumaDevice.destroy()
    },
  }
}
