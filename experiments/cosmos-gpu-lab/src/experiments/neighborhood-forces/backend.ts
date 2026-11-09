import { createSpatialGridResources, type SpatialGridBackend } from '../spatial-grid/resources'
import circleShader from '../point-rendering/webgpu/shaders/circle.wgsl?raw'
import { summarizeSamples, type SampleSummary } from '../performance-lab/backend'
import { BRUTE_LIMIT, MAX_POINTS, validateStep, type ForceParameters, type Validation } from './reference'
import forceShader from './shaders/forces.wgsl?raw'
import serialShader from './shaders/forces-serial.wgsl?raw'
import chunkedShader from './shaders/forces-chunked.wgsl?raw'
import { diagnoseContributions } from './precision'
import integrateShader from './shaders/integrate.wgsl?raw'
import { chooseBatchSize, createGpuTimer, type TimestampSample } from './gpu-timer'

const BUFFER_USAGE = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 } as const
const MAP_MODE = { READ: 1 } as const

export type Accumulation = 'blocked' | 'serial' | 'chunked'

export type Method = 'brute' | 'grid'
export type Stage = 'grid' | 'force' | 'integration' | 'render' | 'tick'
export type Timing = {
  stage: Stage;
  batchSize: number;
  calibration: { completion: number; timestamp: TimestampSample | null };
  batchCompletionSamples: number[];
  batchSubmitSamples: number[];
  gpuSamples: number[] | null;
  samples: number[];
  submitSamples: number[];
  completion: SampleSummary;
  submit: SampleSummary;
  gpu: SampleSummary | null;
  timestamps: TimestampSample[] | null;
  invalidGpuSamples: number;
}

export async function createNeighborhoodBackend (
  device: GPUDevice,
  initialPositions: Float32Array,
  parameters: ForceParameters,
  gridSize: number,
  method: Method,
  canvas?: HTMLCanvasElement,
  accumulation: Accumulation = 'blocked'
): Promise<NeighborhoodBackend> {
  const shader = accumulation === 'serial' ? serialShader : accumulation === 'chunked' ? chunkedShader : forceShader
  const count = initialPositions.length / 2
  if (!Number.isInteger(count) || count < 1 || count > MAX_POINTS ||
    (method === 'brute' && count > BRUTE_LIMIT)) throw new Error('Unsupported point count')
  if (![16, 32, 64].includes(gridSize) || !(parameters.radius > 0 && parameters.radius <= 0.25)) {
    throw new Error('Unsupported grid size or interaction radius')
  }
  if (Array.from(initialPositions).some(value => !Number.isFinite(value) || Math.abs(value) > 1)) {
    throw new Error('Positions must be finite and within [-1, 1]')
  }
  if (count * 16 > device.limits.maxStorageBufferBindingSize ||
    count * 16 > device.limits.maxBufferSize || Math.ceil(count / 128) > device.limits.maxComputeWorkgroupsPerDimension) {
    throw new Error('This preset exceeds the device buffer or dispatch limits')
  }
  const owned: GPUBuffer[] = []
  let grid: SpatialGridBackend | undefined
  let context: GPUCanvasContext | null = null
  let destroyed = false
  let timer: ReturnType<typeof createGpuTimer>
  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    grid?.destroy()
    timer?.destroy()
    for (const buffer of owned) buffer.destroy()
    context?.unconfigure()
  }
  const buffer = (label: string, size: number, usage: number): GPUBuffer => {
    const resource = device.createBuffer({ label: `${method} ${label}`, size, usage })
    owned.push(resource)
    return resource
  }
  const storage = (label: string, size: number): GPUBuffer => buffer(label, size,
    BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.COPY_DST)
  const bindings = (pipeline: GPUComputePipeline | GPURenderPipeline, buffers: GPUBuffer[]): GPUBindGroup =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map((resource, binding) => ({ binding, resource: { buffer: resource } })),
    })
  device.pushErrorScope('validation')
  let scopeOpen = true
  try {
    const positions = [storage('positions A', count * 8), storage('positions B', count * 8)]
    const velocities = [storage('velocities A', count * 8), storage('velocities B', count * 8)]
    const forces = storage('forces, neighbor and candidate counts', count * 16)
    const uniforms = buffer('parameters', 32, BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST)
    const parameterData = new ArrayBuffer(32)
    new Uint32Array(parameterData).set([count, gridSize])
    new Float32Array(parameterData).set([
      parameters.radius, parameters.strength, parameters.dt, parameters.damping,
    ], 2)
    device.queue.writeBuffer(uniforms, 0, parameterData)

    if (method === 'grid') {
      grid = createSpatialGridResources(device, positions, count, gridSize)
    }
    const forcePipeline = await device.createComputePipelineAsync({
      label: `${method} neighborhood force`,
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: shader }), entryPoint: method },
    })
    const integrationPipeline = await device.createComputePipelineAsync({
      label: 'damped integration',
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: integrateShader }), entryPoint: 'main' },
    })
    const forceBindings = positions.map(position => bindings(forcePipeline,
      [position, forces, uniforms, ...(grid ? [grid.cellOffsets, grid.pointIndices] : [])]))
    const integrationBindings = positions.map((position, index) => bindings(integrationPipeline,
      [position, velocities[index], forces, positions[1 - index], velocities[1 - index], uniforms]))

    let renderPipeline: GPURenderPipeline | undefined
    let renderBindings: GPUBindGroup[] = []
    if (canvas) {
      context = canvas.getContext('webgpu') as unknown as GPUCanvasContext | null
      if (!context) throw new Error('WebGPU canvas is unavailable')
      const format = navigator.gpu.getPreferredCanvasFormat()
      context.configure({ device, format, alphaMode: 'opaque' })
      const colors = storage('circle colors', count * 16)
      const colorData = new Float32Array(count * 4)
      for (let i = 0; i < count; i += 1) colorData.set([0.56, 0.78, 0.71, 0.8], i * 4)
      device.queue.writeBuffer(colors, 0, colorData)
      const renderUniforms = buffer('circle uniforms', 16, BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST)
      device.queue.writeBuffer(renderUniforms, 0, new Float32Array([count > 4096 ? 2 : 4, canvas.width, canvas.height, 0]))
      const module = device.createShaderModule({ code: circleShader })
      renderPipeline = await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: {
          module,
          entryPoint: 'fragmentMain',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      })
      renderBindings = positions.map(position => bindings(renderPipeline!, [position, colors, renderUniforms]))
    }
    let active = 0
    let ticks = 0
    let failure: string | undefined
    device.lost.then(info => { if (!destroyed) failure = `WebGPU device lost: ${info.message}` })
    const check = (): void => {
      if (destroyed) throw new Error('Experiment has been destroyed')
      if (failure) throw new Error(failure)
    }
    const compute = (
      encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, group: GPUBindGroup,
      timestampWrites?: GPUComputePassTimestampWrites
    ): void => {
      const pass = encoder.beginComputePass({ timestampWrites })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(Math.ceil(count / 128))
      pass.end()
    }
    const draw = (encoder: GPUCommandEncoder, index: number, timestampWrites?: GPURenderPassTimestampWrites): void => {
      if (!context || !renderPipeline) return
      const pass = encoder.beginRenderPass({
        timestampWrites,
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.075, g: 0.087, b: 0.105, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      })
      pass.setPipeline(renderPipeline)
      pass.setBindGroup(0, renderBindings[index])
      pass.draw(6, count)
      pass.end()
    }
    const encode = (encoder: GPUCommandEncoder, stage: Stage, timestamps?: GPUComputePassTimestampWrites): void => {
      const edge = (which: 'start' | 'end'): GPUComputePassTimestampWrites | undefined => {
        const index = which === 'start' ? timestamps?.beginningOfPassWriteIndex : timestamps?.endOfPassWriteIndex
        if (index === undefined || !timestamps) return undefined
        return which === 'start'
          ? { querySet: timestamps.querySet, beginningOfPassWriteIndex: index }
          : { querySet: timestamps.querySet, endOfPassWriteIndex: index }
      }
      if (stage === 'grid' || stage === 'tick') {
        grid?.encodeBuild(encoder, active, stage === 'grid' ? timestamps : edge('start'))
      }
      if (stage === 'force' || stage === 'tick') {
        compute(encoder, forcePipeline, forceBindings[active], stage === 'force'
          ? timestamps
          : grid ? undefined : edge('start'))
      }
      if (stage === 'integration' || stage === 'tick') {
        compute(encoder, integrationPipeline, integrationBindings[active], stage === 'integration'
          ? timestamps
          : canvas ? undefined : edge('end'))
      }
      if (stage === 'render' || stage === 'tick') {
        draw(encoder, 1 - active, stage === 'render' ? timestamps : edge('end'))
      }
    }
    const reset = (): void => {
      check()
      active = 0
      ticks = 0
      for (const position of positions) device.queue.writeBuffer(position, 0, initialPositions as Float32Array<ArrayBuffer>)
      const encoder = device.createCommandEncoder()
      for (const velocity of velocities) encoder.clearBuffer(velocity)
      encoder.clearBuffer(forces)
      draw(encoder, active)
      device.queue.submit([encoder.finish()])
    }
    const read = async (buffers: GPUBuffer[]): Promise<Float32Array[]> => {
      check()
      const staging = buffers.map(resource => device.createBuffer({
        size: resource.size, usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
      }))
      try {
        const encoder = device.createCommandEncoder()
        buffers.forEach((resource, index) => encoder.copyBufferToBuffer(resource, 0, staging[index], 0, resource.size))
        device.queue.submit([encoder.finish()])
        await Promise.all(staging.map(resource => resource.mapAsync(MAP_MODE.READ)))
        check()
        return staging.map(resource => new Float32Array(resource.getMappedRange()).slice())
      } finally {
        for (const resource of staging) resource.destroy()
      }
    }
    reset()
    const initializationError = await device.popErrorScope()
    scopeOpen = false
    if (initializationError) throw new Error(initializationError.message)
    return {
      method,
      get ticks (): number { return ticks },
      reset,
      async step (): Promise<void> {
        check()
        const encoder = device.createCommandEncoder()
        encode(encoder, 'tick')
        device.queue.submit([encoder.finish()])
        active = 1 - active
        ticks += 1
        await device.queue.onSubmittedWorkDone()
        check()
      },
      async validate (diagnose = false, sampleCount = 128): Promise<Validation> {
        check()
        const encoder = device.createCommandEncoder()
        grid?.encodeBuild(encoder, active)
        compute(encoder, forcePipeline, forceBindings[active])
        compute(encoder, integrationPipeline, integrationBindings[active])
        device.queue.submit([encoder.finish()])
        const data = await read([positions[active], velocities[active], forces, positions[1 - active], velocities[1 - active]])
        const validation = validateStep(data[0], data[1], data[2], data[3], data[4], parameters, sampleCount)
        if (diagnose && grid && validation.worstForce) {
          const output = device.createBuffer({ size: count * 16, usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC })
          const params = device.createBuffer({ size: 32, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST })
          try {
            const diagnosticParameters = parameterData.slice(0)
            new Uint32Array(diagnosticParameters)[6] = validation.worstForce.index
            device.queue.writeBuffer(params, 0, diagnosticParameters)
            const pipeline = await device.createComputePipelineAsync({
              layout: 'auto',
              compute: {
                module: device.createShaderModule({ code: shader }),
                entryPoint: 'captureContributions',
              },
            })
            const group = device.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: positions[active] } }, { binding: 2, resource: { buffer: params } },
                { binding: 4, resource: { buffer: grid.pointIndices } }, { binding: 5, resource: { buffer: output } },
              ],
            })
            const capture = device.createCommandEncoder()
            compute(capture, pipeline, group)
            device.queue.submit([capture.finish()])
            const [contributions] = await read([output])
            validation.accumulationDiagnostic = diagnoseContributions(contributions, parameters.strength, validation.worstForce)
          } finally { output.destroy(); params.destroy() }
        }
        return validation
      },
      async benchmark (cancelled: () => boolean, fixedBatchSize?: number, requestedStages?: Stage[]): Promise<Timing[]> {
        if (fixedBatchSize !== undefined && (!Number.isInteger(fixedBatchSize) || fixedBatchSize < 1 || fixedBatchSize > 64)) {
          throw new Error('Batch size must be an integer from 1 to 64')
        }
        // Frozen-input snapshots isolate costs without letting distributions drift between methods.
        reset()
        timer ??= createGpuTimer(device)
        const prepare = device.createCommandEncoder()
        encode(prepare, 'tick')
        device.queue.submit([prepare.finish()])
        await device.queue.onSubmittedWorkDone()
        const results: Timing[] = []
        const stages: Stage[] = [...(grid ? ['grid' as const] : []), 'force', 'integration',
          ...(canvas ? ['render' as const] : []), 'tick']
        const measuredStages = requestedStages ? stages.filter(stage => requestedStages.includes(stage)) : stages
        for (const stage of measuredStages) {
          const measure = async (batchSize: number): Promise<{
            completion: number; submit: number; timestamp: TimestampSample | null;
          }> => {
            check()
            if (cancelled()) throw new Error('Benchmark cancelled')
            const started = performance.now()
            const encoder = device.createCommandEncoder()
            for (let operation = 0; operation < batchSize; operation += 1) {
              // Only the outermost boundaries write queries; never overwrite a query in a batch.
              const writes = batchSize === 1
                ? timer?.writes()
                : operation === 0
                  ? timer?.writes('start')
                  : operation === batchSize - 1 ? timer?.writes('end') : undefined
              encode(encoder, stage, writes)
            }
            device.queue.submit([encoder.finish()])
            const submit = performance.now() - started
            await device.queue.onSubmittedWorkDone()
            const completion = performance.now() - started
            const timestamp = await timer?.read() ?? null
            check()
            return { completion, submit, timestamp }
          }
          const calibration = await measure(1)
          const batchSize = fixedBatchSize ?? chooseBatchSize(calibration.timestamp?.milliseconds ?? null, calibration.completion)
          const samples: number[] = []
          const submitSamples: number[] = []
          const batchCompletionSamples: number[] = []
          const batchSubmitSamples: number[] = []
          const timestamps: TimestampSample[] | null = timer ? [] : null
          for (let sample = -2; sample < 8; sample += 1) {
            const measurement = await measure(batchSize)
            if (sample >= 0) {
              batchCompletionSamples.push(measurement.completion)
              batchSubmitSamples.push(measurement.submit)
              samples.push(measurement.completion / batchSize)
              submitSamples.push(measurement.submit / batchSize)
              if (measurement.timestamp) timestamps?.push(measurement.timestamp)
            }
          }
          const gpuSamples = timestamps?.flatMap(sample => sample.milliseconds === null ? [] : [sample.milliseconds / batchSize]) ?? null
          results.push({
            stage,
            batchSize,
            calibration: { completion: calibration.completion, timestamp: calibration.timestamp },
            batchCompletionSamples,
            batchSubmitSamples,
            samples,
            submitSamples,
            timestamps,
            gpuSamples,
            gpu: gpuSamples?.length ? summarizeSamples(gpuSamples) : null,
            invalidGpuSamples: timestamps ? timestamps.length - (gpuSamples?.length ?? 0) : 0,
            completion: summarizeSamples(samples),
            submit: summarizeSamples(submitSamples),
          })
        }
        reset()
        return results
      },
      destroy,
    }
  } catch (error) {
    if (scopeOpen) await device.popErrorScope()
    destroy()
    throw error
  }
}

export type NeighborhoodBackend = {
  method: Method;
  readonly ticks: number;
  reset: () => void;
  step: () => Promise<void>;
  validate: (diagnose?: boolean, sampleCount?: number) => Promise<Validation>;
  benchmark: (cancelled: () => boolean, fixedBatchSize?: number, requestedStages?: Stage[]) => Promise<Timing[]>;
  destroy: () => void;
}
