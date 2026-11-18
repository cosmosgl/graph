import { evaluate } from '../integrated-webgpu/evaluate'
import type { Integrated } from '../integrated-webgpu/runtime'
import { assessmentChecks, type Assessment, type Check } from './checks'

export const latencyPlan = ['normal', 'traced', 'traced', 'normal'] as const
export const latencyProtocol = 'Four blocks: normal, traced, traced, normal. Each resets Karate Club (34 members / 78 links), ' +
  'then uses the existing 60 warmup ticks, 300 evolving intervals, 20 paused picks, 20 running picks and 20 controlled drag moves. ' +
  'Keep the tab visible and its size fixed. Trace adds frame/pick spans, animation callbacks and 16-ms timer callbacks. ' +
  'The full 50-ms feedback target and all existing checks remain unchanged. Stop after four blocks; export incomplete work too.'

export type Span = { kind: 'frame' | 'pick'; start: number; submitted?: number; end?: number; tick: number; simulate?: boolean; feedbackIndex?: number }
export type Pulse = { kind: 'animation' | 'timer'; at: number; timestamp?: number }
export type LatencyBlock = {
  index: number; mode: typeof latencyPlan[number]; startedAt: string; endedAt?: string;
  firstFeedback: number; lastFeedback?: number; state: 'incomplete' | 'complete'; error?: string;
  checks?: Check[]; assessment?: Assessment; spans: Span[]; pulses: Pulse[];
}

// Local wrappers observe the existing runtime; no shader, queue or feedback endpoint changes.
export function traceRuntime (r: Integrated, block: LatencyBlock): () => void {
  const frame = r.frame; const pick = r.pick
  r.frame = (...args): Promise<void> => {
    const span: Span = { kind: 'frame', start: performance.now(), tick: r.tick, simulate: args[0] ?? r.running }
    block.spans.push(span)
    const pending = frame(...args); span.submitted = performance.now()
    return pending.finally(() => { span.end = performance.now() })
  }
  r.pick = (...args): Promise<number | null> => {
    const span: Span = { kind: 'pick', start: performance.now(), tick: r.tick, feedbackIndex: r.feedback.length }
    block.spans.push(span)
    return pick(...args).finally(() => { span.end = performance.now() })
  }
  let raf = 0; let stopped = false
  const pulse = (timestamp: number): void => {
    if (stopped) return
    block.pulses.push({ kind: 'animation', at: performance.now(), timestamp }); raf = requestAnimationFrame(pulse)
  }
  raf = requestAnimationFrame(pulse)
  const timer = setInterval(() => { block.pulses.push({ kind: 'timer', at: performance.now() }) }, 16)
  return (): void => { stopped = true; cancelAnimationFrame(raf); clearInterval(timer); r.frame = frame; r.pick = pick }
}

export async function investigateLatency (
  r: Integrated, reset: () => Promise<void>, cancelled: () => boolean,
  progress: (text: string) => void, blocks: LatencyBlock[], completed: (block: LatencyBlock) => void
): Promise<void> {
  const rect = r.canvas.getBoundingClientRect(); const ratio = devicePixelRatio
  let interrupted = false
  const visibility = (): void => { interrupted ||= document.visibilityState !== 'visible' }
  const resize = (): void => { interrupted = true }
  const observer = new ResizeObserver(() => {
    const current = r.canvas.getBoundingClientRect()
    interrupted ||= Math.abs(current.width - rect.width) > 0.5 || Math.abs(current.height - rect.height) > 0.5
  })
  observer.observe(r.canvas)
  const guard = (): boolean => cancelled() || interrupted || document.visibilityState !== 'visible' || devicePixelRatio !== ratio
  document.addEventListener('visibilitychange', visibility); window.addEventListener('resize', resize)
  try {
    for (const [index, mode] of latencyPlan.entries()) {
      const block: LatencyBlock = {
        index: index + 1,
        mode,
        startedAt: new Date().toISOString(),
        firstFeedback: r.feedback.length,
        state: 'incomplete',
        spans: [],
        pulses: [],
      }
      blocks.push(block)
      let stop = (): void => {}
      try {
        if (guard()) throw new Error('Investigation interrupted by cancellation, visibility or viewport change')
        await reset()
        if (guard()) throw new Error('Investigation interrupted during reset')
        if (mode === 'traced') stop = traceRuntime(r, block)
        const result = await evaluate(r, guard, text => { progress(`Block ${index + 1}/4 · ${mode} · ${text}`) })
        if (guard()) throw new Error('Investigation interrupted; no completed verdict for this block')
        block.assessment = result; block.checks = assessmentChecks(result); block.state = 'complete'
      } catch (e) { block.error = String(e); throw e } finally {
        r.pause(); stop(); block.lastFeedback = r.feedback.length; block.endedAt = new Date().toISOString(); completed(block)
      }
    }
  } finally { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('resize', resize) }
}
