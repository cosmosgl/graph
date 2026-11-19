import { Buffer, type ComputePass, type Device, type QuerySet } from '@luma.gl/core'
import { createDevice, readFloats, upload, waitForGpu } from '../../gpu/luma'
import { centerAggregate } from '../combined-layout/center-reference'
import { createCenterWebGPU } from '../combined-layout/center-webgpu'
import type { CenterReduction } from '../combined-layout/center-reduction'
import { compareArray } from '../many-body/reference'
import { measureBatch, summarize, timestamps, TIMING_POLICY, type Measurement } from '../many-body/timing'
import { createBlendReduction } from './webgl/reduction'
import { createLinearCenterForce } from './linear-force'

export type CenterScaleInput = { points: Float32Array; xy: Float32Array; center: [number, number] }
export type CenterScaleVariant = {
  variant: CenterReduction; aggregate: number[]; countExact: boolean; aggregateBitsExact: boolean;
  error: number; sampledForceCheck: ReturnType<typeof compareArray>;
  reduction: { summary: ReturnType<typeof summarize>; samples: Measurement[] };
  force: { summary: ReturnType<typeof summarize>; samples: Measurement[] };
}
export type CenterScaleResult = {
  count: number; cpuCenter: [number, number]; webgpu: CenterScaleVariant[];
  linearForce: { comparisonToCurrent: ReturnType<typeof compareArray>; sampledForceCheck: ReturnType<typeof compareArray>;
    timing: { summary: ReturnType<typeof summarize>; samples: Measurement[] }; };
  webgl: { center: [number, number]; countExact: boolean; error: number; elapsedMs: number } | { error: string };
  preview: number[];
}

export function scaleLimit (device: Device): number {
  // The current force shader dispatches 64 threads per workgroup in one dimension,
  // and the aggregate stores its count as float32.
  return Math.floor(Math.min(
    Number(device.limits.maxStorageBufferBindingSize) / 16,
    Number(device.limits.maxBufferSize) / 16,
    Number(device.limits.maxComputeWorkgroupsPerDimension) * 64,
    16777216
  ))
}

export function createScaleInput (count: number): CenterScaleInput {
  if (!Number.isInteger(count) || count < 1) throw new Error('Point count must be a positive integer')
  const points = new Float32Array(count * 4); const xy = new Float32Array(count * 2)
  let seed = 0xdecafbad; let x = 0; let y = 0
  const random = (): number => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return (seed >>> 0) / 0x100000000
  }
  for (let i = 0; i < count; i++) {
    // An offset, asymmetric distribution exposes loss of low bits in the sums.
    points[i * 4] = 2048 + (random() - 0.35) * 200
    points[i * 4 + 1] = -2048 + (random() - 0.65) * 120
    points[i * 4 + 2] = i % 101 === 0 ? 1 : 0 // Pinned points participate in the center.
    xy[i * 2] = points[i * 4]; xy[i * 2 + 1] = points[i * 4 + 1]
    x += points[i * 4]; y += points[i * 4 + 1]
  }
  return { points, xy, center: [x / count, y / count] }
}

function referenceForces (points: Float32Array, sum: Float32Array, sampleCount: number): Float32Array {
  const f = Math.fround; const output = new Float32Array(sampleCount * 4)
  const x = f(sum[0] / sum[2]); const y = f(sum[1] / sum[2])
  for (let i = 0; i < sampleCount; i++) {
    const dx = f(x - points[i * 4]); const dy = f(y - points[i * 4 + 1])
    const distance = f(Math.sqrt(f(f(dx * dx) + f(dy * dy))))
    if (distance > 0) {
      const angle = f(Math.atan2(dy, dx)); const magnitude = f(distance * f(0.01))
      output[i * 4] = f(magnitude * f(Math.cos(angle))); output[i * 4 + 1] = f(magnitude * f(Math.sin(angle)))
    }
  }
  return output
}

export async function runScaleCount (
  device: Device, count: number, progress: (message: string) => void = (): void => {},
  cancelled: () => boolean = (): boolean => false
): Promise<CenterScaleResult> {
  const limit = scaleLimit(device)
  if (count > limit) throw new Error(`Current one-dimensional force dispatch / buffer limit is ${limit.toLocaleString()} points`)
  const input = createScaleInput(count); const expected = centerAggregate(input.points)
  const sampleCount = Math.min(count, 64); const expectedForces = referenceForces(input.points, expected, sampleCount)
  const positions = upload(device, input.points)
  const forces = device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })
  let variant: CenterReduction = 'high-low'
  let center: Awaited<ReturnType<typeof createCenterWebGPU>> | undefined
  let linear: Awaited<ReturnType<typeof createLinearCenterForce>> | undefined
  let linearForce: CenterScaleResult['linearForce'] | undefined
  const measured: CenterScaleVariant[] = []
  const timing = async (stage: 'reduction' | 'force' | 'linear'): Promise<{ summary: ReturnType<typeof summarize>; samples: Measurement[] }> => {
    const samples: Measurement[] = []
    for (let i = 0; i < TIMING_POLICY.warmups + TIMING_POLICY.samples; i++) {
      if (cancelled()) throw new Error('Cancelled')
      if (document.visibilityState !== 'visible') throw new Error('Keep the tab visible during measurement')
      const measurement = await measureBatch(device, 1, (query: QuerySet | undefined, first: boolean, last: boolean) => {
        const pass: ComputePass = device.beginComputePass(timestamps(query, first, last))
        try {
          if (stage === 'reduction') center!.encodeReduction(pass, positions)
          else if (stage === 'force') center!.encodeForce(pass, positions, 1, 1)
          else linear!.encode(pass, 1, 1)
        } finally { pass.end() }
      })
      if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during measurement')
      if (i >= TIMING_POLICY.warmups) samples.push(measurement)
    }
    return { summary: summarize(samples), samples }
  }
  try {
    center = await createCenterWebGPU(device, count, forces, () => variant)
    for (const choice of ['f32', 'high-low'] as const) {
      variant = choice; progress(`${count.toLocaleString()} points · ${choice} reduction`)
      const reduction = await timing('reduction')
      const aggregate = await center.read()
      progress(`${count.toLocaleString()} points · ${choice} force`)
      const force = await timing('force')
      const sampled = await readFloats(forces, sampleCount * 16)
      const bits = new Uint32Array(aggregate.buffer); const expectedBits = new Uint32Array(expected.buffer)
      measured.push({
        variant,
        aggregate: Array.from(aggregate),
        countExact: aggregate[2] === count,
        aggregateBitsExact: bits.every((value, index) => value === expectedBits[index]),
        error: Math.hypot(aggregate[0] / aggregate[2] - input.center[0], aggregate[1] / aggregate[2] - input.center[1]),
        sampledForceCheck: compareArray(sampled, expectedForces),
        reduction,
        force,
      })
    }
    // Compare every candidate force against the existing shader, outside timing.
    const currentForces = await readFloats(forces)
    linear = await createLinearCenterForce(device, count, positions, forces, center.resultBuffer())
    progress(`${count.toLocaleString()} points · linear force candidate`)
    const linearTiming = await timing('linear')
    const linearForces = await readFloats(forces)
    linearForce = {
      comparisonToCurrent: compareArray(linearForces, currentForces),
      sampledForceCheck: compareArray(linearForces.subarray(0, sampleCount * 4), expectedForces),
      timing: linearTiming,
    }
  } finally { linear?.destroy(); center?.destroy(); forces.destroy(); positions.destroy() }

  if (cancelled()) throw new Error('Cancelled')
  progress(`${count.toLocaleString()} points · WebGL blend control`)
  let gl: Device | undefined; let reduction: ReturnType<typeof createBlendReduction> | undefined
  let webgl: CenterScaleResult['webgl']
  try {
    gl = await createDevice('webgl', document.createElement('canvas'))
    reduction = createBlendReduction(gl, count); reduction.positions.write(input.xy)
    await waitForGpu(gl)
    const start = performance.now()
    reduction.encode(); gl.submit()
    const result = reduction.read()
    const elapsedMs = performance.now() - start
    const actual: [number, number] = [result[0] / result[2], result[1] / result[2]]
    webgl = { center: actual, countExact: result[2] === count, error: Math.hypot(actual[0] - input.center[0], actual[1] - input.center[1]), elapsedMs }
  } catch (error) { webgl = { error: String(error) } } finally { reduction?.destroy(); gl?.destroy() }
  const preview = Array.from(input.xy.subarray(0, Math.min(count, 2000) * 2))
  return { count, cpuCenter: input.center, webgpu: measured, linearForce: linearForce!, webgl, preview }
}
