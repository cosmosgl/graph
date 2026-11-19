import type { ResidentMotionSample } from '../many-body-grid/resident-graph'
import { percentile } from './field-metrics'

type TracerFrame = { tick: number; xy: number[]; fieldBox: number[]; camera: number[] }
type Turns = { crossed: number[]; stayed: number[] }
type TurnSummary = { count: number; medianPx: number | null; p95Px: number | null; maxPx: number | null }
export type MotionResult = { tracers: TracerFrame[]; turns: Array<{ ticks: number[]; level: number; crossed: TurnSummary; stayed: TurnSummary }> }
const levels = [8, 16, 32, 64]
const windows = [[3, 10], [11, 50], [51, 200]]

// The GPU index stores the exact center of each target's finest cell. A
// power-of-two parent address recovers its coarse force cell after gravity.
export function trackMotion (initial: Float32Array, controlFrames?: TracerFrame[]): {
  add(tick: number, frame: ResidentMotionSample): void;
  result(): MotionResult;
} {
  let previous = initial; let previousMove = new Float64Array(initial.length / 2)
  let previousKeys = new Int32Array((initial.length / 4) * levels.length)
  const groups: Turns[][] = windows.map(() => levels.map(() => ({ crossed: [], stayed: [] })))
  const tracers: TracerFrame[] = []
  const quantiles = (values: number[]): TurnSummary => ({
    count: values.length,
    medianPx: values.length ? percentile(values, 0.5) : null,
    p95Px: values.length ? percentile(values, 0.95) : null,
    maxPx: values.length ? values.reduce((max, value) => Math.max(max, value), 0) : null,
  })
  return {
    add (tick, { points, normalized, fieldBox, view }): void {
      const camera = controlFrames?.[tick - 1].camera ?? [...view]
      const scale = 340 / (camera[2] * 1.1); const xy: number[] = []
      const keys = new Int32Array(previousKeys.length); const move = new Float64Array(previousMove.length)
      const range = windows.findIndex(([first, last]) => tick >= first && tick <= last)
      for (let i = 2; i < points.length / 4; i++) {
        const j = i * 4; const k = i * 2
        move[k] = points[j] - previous[j]; move[k + 1] = points[j + 1] - previous[j + 1]
        const turn = scale * Math.hypot(move[k] - previousMove[k], move[k + 1] - previousMove[k + 1])
        for (const [l, n] of levels.entries()) {
          const index = i * levels.length + l
          keys[index] = Math.floor((normalized[k + 1] + 1) * n / 2) * n + Math.floor((normalized[k] + 1) * n / 2)
          if (range >= 0) {
            const group = groups[range][l]
            ;(keys[index] === previousKeys[index] ? group.stayed : group.crossed).push(turn)
          }
        }
        if ((i - 2) % 8 === 0) xy.push(points[j], points[j + 1])
      }
      tracers.push({ tick, xy, camera, fieldBox: [...fieldBox] })
      previous = points; previousMove = move; previousKeys = keys
    },
    result (): MotionResult {
      return {
        tracers,
        turns: groups.flatMap((row, w) => row.map((group, l) => ({
          ticks: windows[w], level: levels[l], crossed: quantiles(group.crossed), stayed: quantiles(group.stayed),
        }))),
      }
    },
  }
}
