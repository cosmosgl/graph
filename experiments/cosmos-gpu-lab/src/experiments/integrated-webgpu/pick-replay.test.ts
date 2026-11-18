import { expect, it } from 'vitest'
import { parseCooledCapture, pickReplayVerdict, replaySummary, type PickReplayRow } from './pick-replay'

const source = { recordedAt: '2026-11-18T04:54:48Z', info: 'test provenance', positions: Array(136).fill(0) as number[] }
const result = (): PickReplayRow => ({
  pickReplay: true,
  recordedAt: source.recordedAt,
  info: 'test adapter',
  viewport: [1920, 1200, 2],
  source,
  samples: [1, 2, 3].flatMap(sweep => Array.from({ length: 34 }, (_, i) => ({
    kind: 'pick', sweep, expectedId: i, id: i, x: i, y: i, ms: 16, readMs: 2, highlightMs: 2, opportunityMs: 12,
  }))),
  missingIds: [],
  complete: true,
  interruption: '',
  samePositions: true,
  validation: {
    finite: true,
    samples: 2150,
    boundarySamples: 143,
    interiorIdFailures: 0,
    interiorColorFailures: 0,
    invisiblePicks: 0,
    paintedSamples: 121,
    visiblePoints: 34,
  },
})

it('imports only the recorded cooled geometry and rejects missing or nonfinite checkpoints', () => {
  const capture = (positions: unknown[], tick = 5300): string => JSON.stringify({
    records: [
      { settled: true, recordedAt: source.recordedAt, info: source.info, checkpoints: [{ tick, positions }], accepted: true },
    ],
  })
  expect(parseCooledCapture(capture(source.positions))).toEqual(source)
  expect(() => parseCooledCapture(capture(source.positions, 5000))).toThrow('tick-5300')
  expect(() => parseCooledCapture(capture([null, ...source.positions.slice(1)]))).toThrow('tick-5300')
  expect(() => parseCooledCapture(capture([1e20, ...source.positions.slice(1)]))).toThrow('tick-5300')
  expect(() => parseCooledCapture(capture(source.positions.slice(4)))).toThrow('tick-5300')
})

it('retains a first-request latency failure even when the p95 passes', () => {
  const r = result(); expect(pickReplayVerdict(r)).toBe('Pass within paused replay scope')
  r.samples[0] = { ...r.samples[0], ms: 68.2, readMs: 54.2 }
  const summary = replaySummary(r)[0]
  expect(summary.p95).toBe(16); expect(summary.first).toBe(68.2); expect(summary.worst.expectedId).toBe(0)
  expect(pickReplayVerdict(r)).toBe('Not accepted')
  r.samples[0].ms = 50; expect(pickReplayVerdict(r)).toBe('Pass within paused replay scope')
  r.samples[0].ms = 50.01; expect(pickReplayVerdict(r)).toBe('Not accepted')
})

it('cannot accept incomplete samples, wrong IDs, geometry changes or invisible picks', () => {
  const partial = result(); partial.complete = false; partial.samples = partial.samples.slice(0, 9)
  expect(replaySummary(partial)[0].count).toBe(9); expect(pickReplayVerdict(partial)).toBe('Not accepted')
  const missing = result(); missing.samples.pop(); expect(pickReplayVerdict(missing)).toBe('Not accepted')
  const wrong = result(); wrong.samples[0].id = null; expect(pickReplayVerdict(wrong)).toBe('Not accepted')
  const moved = result(); moved.samePositions = false; expect(pickReplayVerdict(moved)).toBe('Not accepted')
  const invisible = result(); invisible.validation!.invisiblePicks = 1; expect(pickReplayVerdict(invisible)).toBe('Not accepted')
})
