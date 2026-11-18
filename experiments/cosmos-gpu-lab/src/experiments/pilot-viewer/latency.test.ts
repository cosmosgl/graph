import { expect, test, vi } from 'vitest'
import { evaluate } from '../integrated-webgpu/evaluate'
import type { Integrated } from '../integrated-webgpu/runtime'
import { investigateLatency, latencyPlan, traceRuntime, type LatencyBlock } from './latency'
import type { Assessment } from './checks'

vi.mock('../integrated-webgpu/evaluate', () => ({ evaluate: vi.fn() }))
const measured = {
  frames: { median: 16, p95: 17, max: 18 },
  within33: 1,
  frameCount: 300,
  interactions: {
    pick: { max: 17 },
    activePick: { max: 100.4 },
    drag: { max: 18 },
    exactIds: true,
    dragPinned: true,
    pause: true,
    resume: true,
    resize: true,
  },
  validation: { finite: true, paintedSamples: 1, samples: 10, interiorIdFailures: 0, interiorColorFailures: 0, invisiblePicks: 0 },
} as Assessment
function runtime (): Integrated {
  const canvas = document.createElement('canvas')
  return { canvas, tick: 0, running: false, feedback: [], frame: vi.fn(async () => {}), pick: vi.fn(async () => 33), pause: vi.fn() } as unknown as Integrated
}
test('tracing retains return values and restores methods and scheduled probes', async () => {
  const r = runtime(); const frame = r.frame; const pick = r.pick
  const block: LatencyBlock = { index: 1, mode: 'traced', startedAt: '', firstFeedback: 0, state: 'incomplete', spans: [], pulses: [] }
  const stop = traceRuntime(r, block)
  try {
    await r.frame(false); expect(await r.pick(1, 2)).toBe(33)
    expect(block.spans.map(span => span.kind)).toEqual(['frame', 'pick'])
    expect(block.spans.every(span => span.end! >= span.start)).toBe(true)
  } finally { stop() }
  expect(r.frame).toBe(frame); expect(r.pick).toBe(pick)
})
test('runs the fixed budget even when a feedback check fails', async () => {
  vi.mocked(evaluate).mockResolvedValue(measured)
  const r = runtime(); const reset = vi.fn(async () => {}); const blocks: LatencyBlock[] = []; const completed = vi.fn()
  await investigateLatency(r, reset, () => false, () => {}, blocks, completed)
  expect(blocks.map(b => b.mode)).toEqual([...latencyPlan])
  expect(reset).toHaveBeenCalledTimes(4); expect(completed).toHaveBeenCalledTimes(4)
  expect(blocks.every(b => b.state === 'complete' && b.checks![1].pass === false)).toBe(true)
})
test('keeps an interrupted block incomplete even if its measurements returned', async () => {
  let cancelled = false
  vi.mocked(evaluate).mockImplementation(async () => { cancelled = true; return measured })
  const r = runtime(); const frame = r.frame; const blocks: LatencyBlock[] = []
  await expect(investigateLatency(r, async () => {}, () => cancelled, () => {}, blocks, () => {})).rejects.toThrow('interrupted')
  expect(blocks).toHaveLength(1); expect(blocks[0].state).toBe('incomplete'); expect(blocks[0].checks).toBeUndefined()
  expect(r.frame).toBe(frame)
})
