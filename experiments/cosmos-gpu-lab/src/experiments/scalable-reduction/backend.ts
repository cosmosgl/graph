import { Buffer, type ComputePass, type Bindings } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, createDevice, createStorageRenderer, readFloats, upload, waitForGpu } from '../../gpu/luma'
import drawCenterShader from './shaders/draw-center.wgsl?raw'
import drawPointsShader from './shaders/draw-points.wgsl?raw'
import initializeShader from './shaders/initialize.wgsl?raw'
import reducePartialsShader from './shaders/reduce-partials.wgsl?raw'
import reducePointsShader from './shaders/reduce-points.wgsl?raw'
import rotateShader from './shaders/rotate.wgsl?raw'

export const WORKGROUP_SIZE = 256
export const MAX_RENDERED_POINTS = 500_000

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
  submitMilliseconds: number;
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

type ReductionStage = { outputCount: number; kernel: Kernel; bindings: Bindings }

export function formatBytes (bytes: number): string {
  return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`
}

export async function createScalableReductionBackend (canvas: HTMLCanvasElement, pointCount: number): Promise<ScalableReductionBackend> {
  const device = await createDevice('webgpu', canvas)
  const positionBytes = pointCount * 8; const firstPartialCount = Math.ceil(pointCount / WORKGROUP_SIZE)
  const partialBytes = Math.max(16, firstPartialCount * 16)
  if (positionBytes > device.limits.maxStorageBufferBindingSize || positionBytes > device.limits.maxBufferSize ||
    firstPartialCount > device.limits.maxComputeWorkgroupsPerDimension) {
    device.destroy(); throw new Error('Point count exceeds this device’s buffer or dispatch limits')
  }
  const positions = device.createBuffer({ byteLength: positionBytes, usage: Buffer.STORAGE })
  const partials = [0, 1].map(() => device.createBuffer({ byteLength: partialBytes, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
  const parameters = upload(device, new Uint32Array([pointCount, 0, 0, 0]), Buffer.UNIFORM)
  const renderedPointCount = Math.min(pointCount, MAX_RENDERED_POINTS)
  const stride = Math.max(1, Math.floor(pointCount / renderedPointCount))
  const drawParameters = upload(device, new Uint32Array([pointCount, stride, 0, 0]), Buffer.UNIFORM)
  const centerParameters = upload(device, new Float32Array([2 / canvas.width, 2 / canvas.height, 0, 0]), Buffer.UNIFORM)
  const updateLayout = bindingLayout([['positions', 'storage'], ['parameters', 'uniform']])
  const initialize = new Kernel(device, { source: initializeShader, shaderLayout: { bindings: updateLayout } })
  const rotate = new Kernel(device, { source: rotateShader, shaderLayout: { bindings: updateLayout } })
  const reducePoints = new Kernel(device, {
    source: reducePointsShader,
    shaderLayout: {
      bindings: bindingLayout([
        ['positions', 'read-only-storage'], ['outputValues', 'storage'], ['parameters', 'uniform'],
      ]),
    },
  })
  const reducePartials = new Kernel(device, {
    source: reducePartialsShader,
    shaderLayout: {
      bindings: bindingLayout([
        ['inputValues', 'read-only-storage'], ['outputValues', 'storage'], ['parameters', 'uniform'],
      ]),
    },
  })
  const parameterBuffers: Buffer[] = []
  const stages: ReductionStage[] = []
  let input = positions; let count = pointCount; let output = partials[0]
  do {
    output = stages.length % 2 ? partials[1] : partials[0]
    const params = upload(device, new Uint32Array([count, 0, 0, 0]), Buffer.UNIFORM); parameterBuffers.push(params)
    const outputCount = Math.ceil(count / WORKGROUP_SIZE)
    stages.push({
      outputCount,
      kernel: stages.length ? reducePartials : reducePoints,
      bindings: { [stages.length ? 'inputValues' : 'positions']: input, outputValues: output, parameters: params },
    })
    count = outputCount; input = output
  } while (count > 1)
  const final = output
  const points = createStorageRenderer(device, drawPointsShader, 'point-list', bindingLayout([
    ['positions', 'read-only-storage'], ['parameters', 'uniform'],
  ]))
  const marker = createStorageRenderer(device, drawCenterShader, 'triangle-list', bindingLayout([
    ['result', 'read-only-storage'], ['parameters', 'uniform'],
  ]))
  let initialized = false; let destroyed = false
  const check = (): void => { if (destroyed || device.isLost) throw new Error('Reduction device unavailable') }
  const reduce = (pass: ComputePass): void => {
    for (const stage of stages) stage.kernel.dispatch(pass, { x: stage.outputCount, bindings: stage.bindings })
  }
  return {
    pointCount,
    renderedPointCount,
    positionBytes,
    partialBytes: partialBytes * 2,
    reductionCounts: [pointCount, ...stages.map(s => s.outputCount)],
    async run (advance: boolean, readback: boolean): Promise<ReductionRunResult> {
      check(); const start = performance.now()
      const compute = device.beginComputePass()
      if (!initialized || advance) {
        (initialized ? rotate : initialize).dispatch(compute, { x: firstPartialCount, bindings: { positions, parameters } })
        initialized = true
      }
      reduce(compute); compute.end()
      const pass = device.beginRenderPass({ clearColor: [0.09, 0.1, 0.12, 1], clearDepth: false })
      points.kernel.draw(pass, { vertexArray: points.vertexArray, vertexCount: renderedPointCount, bindings: { positions, parameters: drawParameters } })
      marker.kernel.draw(pass, { vertexArray: marker.vertexArray, vertexCount: 6, bindings: { result: final, parameters: centerParameters } })
      pass.end(); device.submit()
      if (!readback) return { elapsedMilliseconds: performance.now() - start, timingKind: 'submit' }
      const values = await readFloats(final, 16)
      return {
        center: { x: values[0] / values[2], y: values[1] / values[2], count: values[2] },
        elapsedMilliseconds: performance.now() - start,
        timingKind: 'readback',
      }
    },
    async benchmark (iterations: number): Promise<ReductionBenchmark> {
      check(); if (!initialized) throw new Error('Run one visible tick before benchmarking')
      const start = performance.now(); const pass = device.beginComputePass()
      for (let i = 0; i < iterations; i++) reduce(pass)
      pass.end(); device.submit(); const submitted = performance.now()
      await waitForGpu(device); const totalMilliseconds = performance.now() - start
      return { iterations, submitMilliseconds: submitted - start, totalMilliseconds, averageMilliseconds: totalMilliseconds / iterations }
    },
    destroy (): void {
      if (destroyed) return
      destroyed = true
      for (const resource of [points, marker, initialize, rotate, reducePoints, reducePartials, positions,
        ...partials, parameters, drawParameters, centerParameters, ...parameterBuffers]) resource.destroy()
      device.destroy()
    },
  }
}
