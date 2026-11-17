import { type Integrated, type FrameTrace, nextFrame } from './runtime'
import { percentiles, interactionCheck } from './evaluate'
import { fit, validateFrame } from './validation'
export const pacingProtocol = '1,024 communities, seed 29471, 960 × 600 CSS px at recorded DPR; three repetitions, ' +
  'rotating RAF-only / redraw / full-tick order. Each window has 60 warmup + 300 measured intervals. ' +
  'No quality calculations or validation readbacks inside windows. Full-tick windows retain the original 95%-within-33-ms and 50-ms pick gates.'
type Mode = 'RAF only' | 'Redraw' | 'Full tick'
type Sample = FrameTrace & { intervalMs: number; wallIntervalMs: number; nextFrameWaitMs: number }
export type PacingRow = {
  pacing: true; repetition: number; mode: Mode; info: string; viewport: number[]; recordedAt: string;
  frames: ReturnType<typeof percentiles>; within33: number; samples: Sample[];
  stages: Record<keyof FrameTrace | 'nextFrameWaitMs' | 'wallIntervalMs', ReturnType<typeof percentiles>>;
  validation: Awaited<ReturnType<typeof validateFrame>>;
  interactions?: Awaited<ReturnType<typeof interactionCheck>>;
  picks: Integrated['feedback'];
}
export async function profilePacing (
  r: Integrated, cancelled: () => boolean, progress: (text: string) => void, record: (row: PacingRow) => void
): Promise<void> {
  const guard = (): void => {
    if (cancelled()) throw new Error('Cancelled; completed pacing rows retained')
    if (document.visibilityState !== 'visible') throw new Error('Pacing run invalidated: tab became hidden')
  }
  // Listen across awaits too: a hide/show between checkpoints must invalidate the window.
  let hidden = false
  const visibility = (): void => { if (document.visibilityState !== 'visible') hidden = true }
  document.addEventListener('visibilitychange', visibility)
  const check = (): void => { guard(); if (hidden) throw new Error('Pacing run invalidated: tab became hidden') }
  const modes: Mode[] = ['RAF only', 'Redraw', 'Full tick']
  try {
    r.pause(); r.resize(960, 600, devicePixelRatio)
    for (let repetition = 0; repetition < 3; repetition++) {
      for (let offset = 0; offset < 3; offset++) {
        check(); const mode = modes[(repetition + offset) % 3]
        progress(`Pacing ${repetition + 1}/3 · ${mode}`)
        await r.replace('communities', 1024)
        // Identical tick-60 starting scene in every control; no CPU quality allocations before timing.
        for (let i = 0; i < 60; i++) { check(); await nextFrame(); await r.frame(true) }
        fit(r, (await r.backend.read()).positions); await r.frame(false)
        for (let i = 0; i < 60; i++) { check(); await nextFrame(); if (mode !== 'RAF only') await r.frame(false) }
        const samples: Sample[] = []; let previous = await nextFrame(); let wallPrevious = performance.now()
        for (let i = 0; i < 300; i++) {
          check(); const trace: FrameTrace = { encodeSimulationMs: 0, encodeDrawMs: 0, completionWaitMs: 0 }
          if (mode !== 'RAF only') await r.frame(mode === 'Full tick', trace)
          const submitted = performance.now(); const stamp = await nextFrame(); const arrived = performance.now()
          samples.push({ ...trace, intervalMs: stamp - previous, wallIntervalMs: arrived - wallPrevious, nextFrameWaitMs: arrived - submitted })
          previous = stamp; wallPrevious = arrived
        }
        check(); const firstPick = r.feedback.length
        const interactions = mode === 'Full tick' ? await interactionCheck(r) : undefined
        check(); const validation = await validateFrame(r); check()
        const stages = Object.fromEntries((['encodeSimulationMs', 'encodeDrawMs', 'completionWaitMs', 'nextFrameWaitMs', 'wallIntervalMs'] as const)
          .map(key => [key, percentiles(samples.map(s => s[key]))])) as PacingRow['stages']
        record({
          pacing: true,
          repetition: repetition + 1,
          mode,
          info: r.info,
          viewport: [r.canvas.width, r.canvas.height, r.renderer.ratio],
          recordedAt: new Date().toISOString(),
          samples,
          frames: percentiles(samples.map(s => s.intervalMs)),
          within33: samples.filter(s => s.intervalMs <= 33).length / samples.length,
          stages,
          validation,
          interactions,
          picks: r.feedback.slice(firstPick),
        })
      }
    }
  } finally { r.pause(); document.removeEventListener('visibilitychange', visibility) }
}

export function pacingVerdict (r: PacingRow): string {
  if (r.mode !== 'Full tick') return 'Control only'
  const i = r.interactions; const v = r.validation
  const passed = r.within33 >= 0.95 && i && i.pick.max <= 50 && i.activePick.max <= 50 && i.drag.max <= 50 &&
    i.exactIds && i.dragPinned && i.pause && i.resume && i.resize && v.finite && v.paintedSamples > 0 &&
    v.interiorIdFailures === 0 && v.interiorColorFailures === 0 && v.invisiblePicks === 0
  return passed ? 'Pass within sampled scope' : 'Not accepted'
}
