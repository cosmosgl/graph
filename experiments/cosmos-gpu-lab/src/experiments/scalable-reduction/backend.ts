import { luma } from '@luma.gl/core'
import { webgpuAdapter, type WebGPUDevice } from '@luma.gl/webgpu'
import drawCenterShader from './shaders/draw-center.wgsl?raw'
import drawPointsShader from './shaders/draw-points.wgsl?raw'
import initializeShader from './shaders/initialize.wgsl?raw'
import reducePartialsShader from './shaders/reduce-partials.wgsl?raw'
import reducePointsShader from './shaders/reduce-points.wgsl?raw'
import rotateShader from './shaders/rotate.wgsl?raw'

export const WORKGROUP_SIZE = 256
export const MAX_RENDERED_POINTS = 500_000

const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const
const MAP_MODE_READ = 0x0001

export type ReductionCenter = {
  x: number;
  y: number;
  count: number;
}

export type ReductionRunResult = {
  center?: ReductionCenter;
  elapsedMilliseconds: number;
  timingKind: 'submit' | 'readback';
}

export type ReductionBenchmark = {
  iterations: number;
  totalMilliseconds: number;
  averageMilliseconds: number;
}

export type ScalableReductionBackend = {
  readonly pointCount: number;
  readonly renderedPointCount: number;
  readonly reductionCounts: number[];
  readonly positionBytes: number;
  readonly partialBytes: number;
  run: (advance: boolean, readback: boolean) => Promise<ReductionRunResult>;
  benchmark: (iterations: number) => Promise<ReductionBenchmark>;
  destroy: () => void;
}

type ReductionStage = {
  inputCount: number;
  outputCount: number;
  pipeline: GPUComputePipeline;
  bindings: GPUBindGroup;
}

function createCountBuffer (device: GPUDevice, count: number, label: string): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: 16,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.UNIFORM,
  })
  device.queue.writeBuffer(buffer, 0, new Uint32Array([count, 0, 0, 0]))
  return buffer
}

export function formatBytes (bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export async function createScalableReductionBackend (
  canvas: HTMLCanvasElement,
  pointCount: number
): Promise<ScalableReductionBackend> {
  const lumaDevice = await luma.createDevice({
    id: `scalable-reduction-${pointCount}`,
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

  const positionBytes = pointCount * 2 * Float32Array.BYTES_PER_ELEMENT
  const firstPartialCount = Math.ceil(pointCount / WORKGROUP_SIZE)
  const partialBytes = Math.max(16, firstPartialCount * 4 * Float32Array.BYTES_PER_ELEMENT)
  const maximumStorageBinding = Number(device.limits.maxStorageBufferBindingSize)
  const maximumBufferSize = Number(device.limits.maxBufferSize)
  const maximumDispatch = Number(device.limits.maxComputeWorkgroupsPerDimension)
  if (positionBytes > maximumStorageBinding || positionBytes > maximumBufferSize) {
    lumaDevice.destroy()
    throw new Error(
      `${formatBytes(positionBytes)} position buffer exceeds this device's storage-buffer limit`
    )
  }
  if (firstPartialCount > maximumDispatch) {
    lumaDevice.destroy()
    throw new Error(
      `${firstPartialCount.toLocaleString()} workgroups exceed this device's one-dimensional dispatch limit`
    )
  }

  const positionBuffer = device.createBuffer({
    label: 'resident positions',
    size: positionBytes,
    usage: BUFFER_USAGE.STORAGE,
  })
  const partialBufferA = device.createBuffer({
    label: 'reduction partials A',
    size: partialBytes,
    usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC,
  })
  const partialBufferB = device.createBuffer({
    label: 'reduction partials B',
    size: partialBytes,
    usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC,
  })
  const readbackBuffer = device.createBuffer({
    label: 'optional center readback',
    size: 16,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
  })
  const pointParameters = createCountBuffer(device, pointCount, 'point count')
  const renderedPointCount = Math.min(pointCount, MAX_RENDERED_POINTS)
  const renderStride = Math.max(1, Math.floor(pointCount / renderedPointCount))
  const drawParameters = device.createBuffer({
    label: 'sampled point rendering parameters',
    size: 16,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.UNIFORM,
  })
  device.queue.writeBuffer(
    drawParameters,
    0,
    new Uint32Array([pointCount, renderStride, 0, 0])
  )
  const centerParameters = device.createBuffer({
    label: 'center marker parameters',
    size: 16,
    usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.UNIFORM,
  })
  device.queue.writeBuffer(
    centerParameters,
    0,
    new Float32Array([2 / canvas.width, 2 / canvas.height, 0, 0])
  )

  const initializePipeline = device.createComputePipeline({
    label: 'initialize resident positions',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: initializeShader }),
      entryPoint: 'main',
    },
  })
  const rotatePipeline = device.createComputePipeline({
    label: 'advance resident positions',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: rotateShader }),
      entryPoint: 'main',
    },
  })
  const pointReductionPipeline = device.createComputePipeline({
    label: 'reduce positions',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: reducePointsShader }),
      entryPoint: 'main',
    },
  })
  const partialReductionPipeline = device.createComputePipeline({
    label: 'reduce partial sums',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: reducePartialsShader }),
      entryPoint: 'main',
    },
  })

  const initializeBindings = device.createBindGroup({
    label: 'position initialization bindings',
    layout: initializePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: pointParameters } },
    ],
  })
  const rotateBindings = device.createBindGroup({
    label: 'position advance bindings',
    layout: rotatePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: pointParameters } },
    ],
  })

  const stageParameterBuffers: GPUBuffer[] = []
  const reductionStages: ReductionStage[] = []
  let inputCount = pointCount
  let outputCount = firstPartialCount
  let outputBuffer = partialBufferA
  const firstStageParameters = createCountBuffer(device, inputCount, 'reduction level 0 count')
  stageParameterBuffers.push(firstStageParameters)
  reductionStages.push({
    inputCount,
    outputCount,
    pipeline: pointReductionPipeline,
    bindings: device.createBindGroup({
      label: 'position reduction bindings',
      layout: pointReductionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: positionBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: firstStageParameters } },
      ],
    }),
  })

  while (outputCount > 1) {
    inputCount = outputCount
    outputCount = Math.ceil(inputCount / WORKGROUP_SIZE)
    const inputBuffer = outputBuffer
    outputBuffer = inputBuffer === partialBufferA ? partialBufferB : partialBufferA
    const parameters = createCountBuffer(
      device,
      inputCount,
      `reduction level ${reductionStages.length} count`
    )
    stageParameterBuffers.push(parameters)
    reductionStages.push({
      inputCount,
      outputCount,
      pipeline: partialReductionPipeline,
      bindings: device.createBindGroup({
        label: `partial reduction level ${reductionStages.length}`,
        layout: partialReductionPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: outputBuffer } },
          { binding: 2, resource: { buffer: parameters } },
        ],
      }),
    })
  }
  const finalBuffer = outputBuffer

  const drawPointModule = device.createShaderModule({ code: drawPointsShader })
  const drawPointPipeline = device.createRenderPipeline({
    label: 'draw sampled resident points',
    layout: 'auto',
    vertex: { module: drawPointModule, entryPoint: 'vertexMain' },
    fragment: {
      module: drawPointModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: { topology: 'point-list' },
  })
  const drawPointBindings = device.createBindGroup({
    label: 'sampled point drawing bindings',
    layout: drawPointPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: drawParameters } },
    ],
  })

  const drawCenterModule = device.createShaderModule({ code: drawCenterShader })
  const drawCenterPipeline = device.createRenderPipeline({
    label: 'draw GPU-resident center',
    layout: 'auto',
    vertex: { module: drawCenterModule, entryPoint: 'vertexMain' },
    fragment: {
      module: drawCenterModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  })
  const drawCenterBindings = device.createBindGroup({
    label: 'GPU-resident center drawing bindings',
    layout: drawCenterPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: finalBuffer } },
      { binding: 1, resource: { buffer: centerParameters } },
    ],
  })

  let initialized = false
  let destroyed = false

  const encodeReduction = (pass: GPUComputePassEncoder): void => {
    for (const stage of reductionStages) {
      pass.setPipeline(stage.pipeline)
      pass.setBindGroup(0, stage.bindings)
      pass.dispatchWorkgroups(stage.outputCount)
    }
  }

  return {
    pointCount,
    renderedPointCount,
    reductionCounts: [pointCount, ...reductionStages.map(stage => stage.outputCount)],
    positionBytes,
    partialBytes: partialBytes * 2,
    async run (advance: boolean, readback: boolean): Promise<ReductionRunResult> {
      if (destroyed) throw new Error('The scalable reduction backend has been destroyed')
      const started = performance.now()
      const encoder = device.createCommandEncoder({ label: 'scalable center-mass tick' })
      const computePass = encoder.beginComputePass()

      if (!initialized) {
        computePass.setPipeline(initializePipeline)
        computePass.setBindGroup(0, initializeBindings)
        computePass.dispatchWorkgroups(firstPartialCount)
        initialized = true
      } else if (advance) {
        computePass.setPipeline(rotatePipeline)
        computePass.setBindGroup(0, rotateBindings)
        computePass.dispatchWorkgroups(firstPartialCount)
      }

      encodeReduction(computePass)
      computePass.end()
      if (readback) encoder.copyBufferToBuffer(finalBuffer, 0, readbackBuffer, 0, 16)

      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.09, g: 0.1, b: 0.12, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      })
      renderPass.setPipeline(drawPointPipeline)
      renderPass.setBindGroup(0, drawPointBindings)
      renderPass.draw(renderedPointCount)
      renderPass.setPipeline(drawCenterPipeline)
      renderPass.setBindGroup(0, drawCenterBindings)
      renderPass.draw(6)
      renderPass.end()
      device.queue.submit([encoder.finish()])

      if (!readback) {
        return {
          elapsedMilliseconds: performance.now() - started,
          timingKind: 'submit',
        }
      }

      await readbackBuffer.mapAsync(MAP_MODE_READ)
      const values = new Float32Array(readbackBuffer.getMappedRange()).slice()
      readbackBuffer.unmap()
      return {
        center: {
          x: values[0] / values[2],
          y: values[1] / values[2],
          count: values[2],
        },
        elapsedMilliseconds: performance.now() - started,
        timingKind: 'readback',
      }
    },
    async benchmark (iterations: number): Promise<ReductionBenchmark> {
      if (destroyed) throw new Error('The scalable reduction backend has been destroyed')
      if (!initialized) throw new Error('Run one visible tick before benchmarking')
      const started = performance.now()
      const encoder = device.createCommandEncoder({ label: `${iterations} reduction benchmark iterations` })
      const computePass = encoder.beginComputePass()
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        encodeReduction(computePass)
      }
      computePass.end()
      device.queue.submit([encoder.finish()])
      await device.queue.onSubmittedWorkDone()
      const totalMilliseconds = performance.now() - started
      return {
        iterations,
        totalMilliseconds,
        averageMilliseconds: totalMilliseconds / iterations,
      }
    },
    destroy (): void {
      if (destroyed) return
      destroyed = true
      centerParameters.destroy()
      drawParameters.destroy()
      for (const buffer of stageParameterBuffers) buffer.destroy()
      pointParameters.destroy()
      readbackBuffer.destroy()
      partialBufferB.destroy()
      partialBufferA.destroy()
      positionBuffer.destroy()
      lumaDevice.destroy()
    },
  }
}
