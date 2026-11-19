import { Buffer, type Device, type QuerySet } from '@luma.gl/core'
import { readFloats, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { createCenterWebGPU } from '../combined-layout/center-webgpu'
import { compareArray } from '../many-body/reference'
import { measureBatch, median, timestamps, type Measurement } from '../many-body/timing'
import { createScaleInput, scaleLimit } from './scale-study'

export type OnceTiming = {
  stage: 'force' | 'reduction-and-force';
  operations: number;
  pairs: Array<{ round: number; warmup: boolean; perPoint: Measurement; once: Measurement }>;
  summary: { perPointMs: number; onceMs: number; differenceMs: number; differenceRange: [number, number] } | null;
}
export type OnceStudy = {
  count: number; cpuCenter: [number, number]; aggregate: number[]; storedCenter: number[];
  aggregateBitsExact: boolean; countExact: boolean; centerError: number;
  forceComparison: ReturnType<typeof compareArray>; forceBitDifferences: number;
  timings: OnceTiming[];
}
export const ONCE_POLICY = { warmups: 3, samples: 11, operations: 4 } as const

export async function runOnceStudy (
  device: Device, count: number, progress: (message: string) => void = (): void => {},
  cancelled: () => boolean = (): boolean => false,
  policy: { warmups: number; samples: number; operations: number } = ONCE_POLICY
): Promise<OnceStudy> {
  if (count > scaleLimit(device)) throw new Error(`Point count exceeds the current limit of ${scaleLimit(device).toLocaleString()}`)
  if (!Number.isInteger(policy.warmups) || policy.warmups < 0 || !Number.isInteger(policy.samples) || policy.samples < 1 ||
    !Number.isInteger(policy.operations) || policy.operations < 1 || policy.operations > 64) throw new Error('Invalid timing policy')
  const input = createScaleInput(count); const scope = resourceScope(); const own = scope.own
  try {
    const positions = own(upload(device, input.points))
    const allocate = (): Buffer => own(device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const forcePerPoint = allocate(); const forceOnce = allocate()
    const perPoint = own(await createCenterWebGPU(device, count, forcePerPoint, undefined, 'linear', 'per-point'))
    const once = own(await createCenterWebGPU(device, count, forceOnce, undefined, 'linear', 'once'))
    for (const center of [perPoint, once]) {
      const pass = device.beginComputePass()
      try { center.encode(pass, positions, 1, 1) } finally { pass.end() }
      device.submit()
    }
    const perPointAggregate = await perPoint.read(); const aggregate = await once.read()
    const centerBytes = await once.resultBuffer().readAsync(16, 16)
    const storedCenter = new Float32Array(centerBytes.buffer, centerBytes.byteOffset, 4).slice()
    const perPointBits = new Uint32Array(perPointAggregate.buffer); const onceBits = new Uint32Array(aggregate.buffer)
    const left = await readFloats(forcePerPoint); const right = await readFloats(forceOnce)
    const leftBits = new Uint32Array(left.buffer); const rightBits = new Uint32Array(right.buffer)
    let forceBitDifferences = 0
    for (let i = 0; i < leftBits.length; i++) if (leftBits[i] !== rightBits[i]) forceBitDifferences++
    const forceComparison = compareArray(right, left)
    const timings: OnceTiming[] = []
    for (const stage of ['force', 'reduction-and-force'] as const) {
      const pairs: OnceTiming['pairs'] = []
      for (let round = 0; round < policy.warmups + policy.samples; round++) {
        const measured: Partial<Record<'perPoint' | 'once', Measurement>> = {}
        const order = round % 2 ? ['once', 'perPoint'] as const : ['perPoint', 'once'] as const
        for (const name of order) {
          if (cancelled()) throw new Error('Cancelled')
          if (document.visibilityState !== 'visible') throw new Error('Keep the tab visible during measurement')
          progress(`${count.toLocaleString()} points · ${stage} · pair ${round + 1}/${policy.warmups + policy.samples}`)
          const center = name === 'once' ? once : perPoint
          measured[name] = await measureBatch(device, policy.operations, (query: QuerySet | undefined, first: boolean, last: boolean) => {
            const pass = device.beginComputePass(timestamps(query, first, last))
            try {
              if (stage === 'force') center.encodeForce(pass, positions, 1, 1)
              else center.encode(pass, positions, 1, 1)
            } finally { pass.end() }
          })
          if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during measurement')
        }
        pairs.push({ round, warmup: round < policy.warmups, perPoint: measured.perPoint!, once: measured.once! })
      }
      const samples = pairs.filter(pair => !pair.warmup)
      const valid = pairs.every(pair => [pair.perPoint, pair.once].every(value => value.timerStatus === 'valid' &&
        value.batchGpuMs !== null && Number.isFinite(value.batchGpuMs) && value.batchGpuMs >= 0))
      const perPointTimes = samples.map(pair => pair.perPoint.batchGpuMs! / policy.operations)
      const onceTimes = samples.map(pair => pair.once.batchGpuMs! / policy.operations)
      const differences = samples.map((pair, i) => onceTimes[i] - perPointTimes[i])
      timings.push({
        stage,
        operations: policy.operations,
        pairs,
        summary: valid
          ? {
            perPointMs: median(perPointTimes),
            onceMs: median(onceTimes),
            differenceMs: median(differences),
            differenceRange: [Math.min(...differences), Math.max(...differences)],
          }
          : null,
      })
    }
    return {
      count,
      cpuCenter: input.center,
      aggregate: Array.from(aggregate),
      storedCenter: Array.from(storedCenter),
      aggregateBitsExact: onceBits.every((value, i) => value === perPointBits[i]),
      countExact: aggregate[2] === count && storedCenter[2] === count,
      centerError: Math.hypot(storedCenter[0] - input.center[0], storedCenter[1] - input.center[1]),
      forceComparison,
      forceBitDifferences,
      timings,
    }
  } finally { scope.destroy() }
}
