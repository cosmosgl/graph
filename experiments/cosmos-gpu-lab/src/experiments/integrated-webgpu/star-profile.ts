import type { ComputeScope } from '../many-body/backend'
import type { Snapshot } from '../many-body/reference'
import { readLumaTimer, type TimerStatus } from '../weighted-links/timing'
import { PROFILE_STAGES, stageDurations } from '../combined-layout/stage-timing'
import { type Integrated, nextFrame } from './runtime'
import { percentiles } from './evaluate'
import { fit, validateFrame } from './validation'
export const integratedProfileStages = [...PROFILE_STAGES.slice(0, 2), 'center.force', 'center.integration', ...PROFILE_STAGES.slice(2)]
export const starProfileProtocol = '8,192-point unpinned star, seed 29471, 960 × 600 CSS px at recorded DPR. ' +
  'Three rotated RAF-only / redraw / full-tick controls, 60 warmup ticks + 300 measured frames. ' +
  'Separate stage diagnostic: normal / split / split / normal; each resets, warms 60 ticks, fits, then measures ticks 61–120. ' +
  'Same kernels and order, including center. Split-pass timings are diagnostic only; compare exact final state and color bits outside timing.'
export type StarProfileRow = {
  starProfile: true; window: number; mode: 'normal' | 'split'; info: string; viewport: number[]; recordedAt: string;
  timerStatus: TimerStatus; frames: ReturnType<typeof percentiles>; intervals: number[];
  stages: { name: string; samples: number[] | null }[];
  sameState: { positions: boolean; forces: boolean; colors: boolean };
  validation: Awaited<ReturnType<typeof validateFrame>>;
}
const same = (a: Float32Array, b: Float32Array): boolean => {
  const left = new Uint32Array(a.buffer, a.byteOffset, a.length); const right = new Uint32Array(b.buffer, b.byteOffset, b.length)
  return left.length === right.length && left.every((v, i) => v === right[i])
}
export async function profileStarStages (
  r: Integrated, cancelled: () => boolean, progress: (text: string) => void, record: (row: StarProfileRow) => void
): Promise<void> {
  const device = r.backend.positionSource!().device
  if (!device.features.has('timestamp-query')) throw new Error('GPU timestamps unavailable; no wall-clock substitution')
  let hidden = document.visibilityState !== 'visible'
  const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  const guard = (): void => {
    if (cancelled()) throw new Error('Cancelled; completed stage windows retained')
    if (hidden) throw new Error('Stage profile invalidated: tab became hidden')
  }
  let baseline: Snapshot | undefined; let baselineColor: Uint8Array | undefined
  document.addEventListener('visibilitychange', visibility)
  try {
    r.pause(); r.resize(960, 600, devicePixelRatio)
    for (const [index, mode] of (['normal', 'split', 'split', 'normal'] as const).entries()) {
      guard(); progress(`Star stages ${index + 1}/4 · ${mode} passes`)
      await r.replace('star', 8192)
      for (let i = 0; i < 60; i++) { guard(); await nextFrame(); await r.frame(true) }
      fit(r, (await r.backend.read()).positions); await r.frame(false)
      const names = mode === 'split' ? integratedProfileStages : ['simulation', 'draw']
      const pairs = names.length; const query = device.createQuerySet({ type: 'timestamp', count: pairs * 2 * 60 })
      const intervals: number[] = []; let durations: number[] | null = null
      try {
        let previous = await nextFrame()
        for (let frame = 0; frame < 60; frame++) {
          guard(); const offset = frame * pairs * 2
          if (mode === 'normal') await r.frame(true, undefined, { query, offset })
          else {
            let stage = 0
            const scope: ComputeScope = (name, work) => {
              if (names[stage] !== name) throw new Error(`Unexpected stage ${name}; expected ${names[stage]}`)
              const pass = device.beginComputePass({
                timestampQuerySet: query, beginTimestampIndex: offset + stage * 2, endTimestampIndex: offset + stage * 2 + 1,
              })
              try { work(pass) } finally { pass.end() }
              stage++
            }
            await r.frame(true, undefined, {
              scope,
              draw: {
                timestampQuerySet: query, beginTimestampIndex: offset + (pairs - 1) * 2, endTimestampIndex: offset + (pairs - 1) * 2 + 1,
              },
            })
            if (stage !== pairs - 1) throw new Error('Incomplete integrated stage sequence')
          }
          const stamp = await nextFrame(); intervals.push(stamp - previous); previous = stamp
        }
        const timer = await readLumaTimer({
          async readTimestampDuration (): Promise<number> {
            durations = stageDurations(await query.readResults({ firstQuery: 0, queryCount: pairs * 2 * 60 }), pairs * 60)
            return durations ? durations.reduce((sum, v) => sum + v, 0) : NaN
          },
        })
        guard(); const state = await r.backend.read(); const color = (await r.renderer.snapshot()).color
        baseline ??= state; baselineColor ??= color
        const validation = await validateFrame(r); guard()
        record({
          starProfile: true,
          window: index + 1,
          mode,
          info: r.info,
          viewport: [r.canvas.width, r.canvas.height, r.renderer.ratio],
          recordedAt: new Date().toISOString(),
          timerStatus: timer.status,
          frames: percentiles(intervals),
          intervals,
          stages: names.map((name, stage) => ({
            name,
            samples: timer.status === 'valid' && durations
              ? Array.from({ length: 60 }, (_, frame) => durations![frame * pairs + stage])
              : null,
          })),
          sameState: {
            positions: same(baseline.positions, state.positions),
            forces: same(baseline.forces, state.forces),
            colors: baselineColor.length === color.length && baselineColor.every((v, i) => v === color[i]),
          },
          validation,
        })
      } finally { query.destroy() }
    }
  } finally { r.pause(); document.removeEventListener('visibilitychange', visibility) }
}
