import type { Workload } from './data'
import { measureQuality } from './quality'
import { type Integrated, nextFrame } from './runtime'
import { validateFrame, fit } from './validation'
export const protocol = [
  '60 warmup + 300 measured evolving frames, 5,000-tick cooling, seed 29471, 960 × 600 CSS px at recorded DPR.',
  'Fit once after warmup, outside timing.',
  'One completed GPU frame in flight.',
  'Then 20 paused and 20 running picks, a 20-move drag, pan/zoom, pause/resume, resize and data replacement.',
  'Checks/readbacks are outside frame timing; picking readback stays inside feedback latency.',
].join(' ')
export function percentiles (values: number[]): { median: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    median: sorted[Math.floor(sorted.length * 0.5)] ?? NaN,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? NaN,
    max: sorted.at(-1) ?? NaN,
  }
}
export async function interactionCheck (r: Integrated): Promise<{
  pick: ReturnType<typeof percentiles>; activePick: ReturnType<typeof percentiles>; drag: ReturnType<typeof percentiles>;
  exactIds: boolean; dragPinned: boolean; pause: boolean; resume: boolean; resize: boolean;
}> {
  r.pause(); const points = (await r.backend.read()).positions
  // Select a non-occluded point from the actual ID image, rather than assuming point 0 is on top.
  r.renderer.selected = -1; const snapshot = await r.renderer.snapshot()
  let id = -1; let x = 0; let y = 0
  for (let i = 0; i < snapshot.ids.length; i += 4) {
    const encoded = snapshot.ids[i] + snapshot.ids[i + 1] * 256 + snapshot.ids[i + 2] * 65536
    if (encoded) { id = encoded - 1; x = (i / 4) % snapshot.width; y = Math.floor(i / 4 / snapshot.width); break }
  }
  if (id < 0) throw new Error('No visible point for interaction sequence')
  let exactIds = true; const first = r.feedback.length
  for (let n = 0; n < 20; n++) { r.renderer.selected = -1; if (await r.pick(x, y) !== id) exactIds = false }
  const dragTimes: number[] = []; let destination: [number, number] = [x, y]
  for (let n = 1; n <= 20; n++) {
    const start = performance.now(); destination = [x + n * r.renderer.ratio, y + n * r.renderer.ratio / 2]
    r.drag(id, ...destination); await r.frame(false); await nextFrame(); dragTimes.push(performance.now() - start)
  }
  const expected = r.world(...destination); const actual = (await r.backend.read()).positions
  const dragPinned = actual[id * 4] === Math.fround(expected[0]) && actual[id * 4 + 1] === Math.fround(expected[1]) && actual[id * 4 + 2] === 1
  r.drag(id, ...destination, true)
  // Camera inverses and zoom anchoring are independently checked without altering graph coordinates.
  const anchor = r.world(x, y); r.zoom(1.2, x, y); const anchored = r.world(x, y)
  exactIds &&= Math.hypot(anchor[0] - anchored[0], anchor[1] - anchored[1]) < 1e-8
  r.pan(24, 12); r.pan(-24, -12); r.zoom(1 / 1.2, x, y)
  const before = r.tick; await r.frame(false); await nextFrame(); const pause = before === r.tick
  await r.step(); const resume = r.tick === before + 1
  const w = r.canvas.width / r.renderer.ratio; const h = r.canvas.height / r.renderer.ratio
  r.resize(w - 16, h - 16, r.renderer.ratio); await r.frame(false)
  const resize = r.canvas.width === Math.round((w - 16) * r.renderer.ratio)
  r.resize(w, h, r.renderer.ratio)
  // Original pinned state must survive a drag/release (the stored coordinate itself intentionally changes).
  exactIds &&= (await r.backend.read()).positions[id * 4 + 2] === points[id * 4 + 2]
  const pausedPick = percentiles(r.feedback.slice(first).map(f => f.ms))
  // A last-drawn pinned point gives a stable, non-occluded target during simulation.
  const anchorId = points.length / 4 - 1; const current = (await r.backend.read()).positions.slice(anchorId * 4, anchorId * 4 + 4)
  const anchorScreen: [number, number] = [12 * r.renderer.ratio, 12 * r.renderer.ratio]
  r.drag(anchorId, ...anchorScreen); const activeFirst = r.feedback.length; r.resume()
  try { for (let n = 0; n < 20; n++) if (await r.pick(...anchorScreen) !== anchorId) exactIds = false } finally { r.pause() }
  r.backend.patchPositions!(anchorId, current)
  return {
    pick: pausedPick,
    activePick: percentiles(r.feedback.slice(activeFirst).map(f => f.ms)),
    drag: percentiles(dragTimes),
    exactIds,
    dragPinned,
    pause,
    resume,
    resize,
  }
}
export async function evaluate (r: Integrated, cancelled: () => boolean, progress: (text: string) => void): Promise<{
  frames: ReturnType<typeof percentiles>; within33: number; frameCount: number; durationMs: number;
  interactions: Awaited<ReturnType<typeof interactionCheck>>; validation: Awaited<ReturnType<typeof validateFrame>>;
  quality: { warmup: ReturnType<typeof measureQuality>; end: ReturnType<typeof measureQuality>; residual: ReturnType<typeof measureQuality> };
  workload: { kind: Workload; count: number }; links: number; info: string; viewport: number[]; tick: number; visible: boolean; intervals: number[];
}> {
  r.pause()
  let hidden = document.hidden
  const visibility = (): void => { hidden ||= document.hidden }
  const check = (): void => {
    if (cancelled()) throw new Error('Cancelled')
    if (hidden || document.visibilityState !== 'visible') throw new Error('Measurement interrupted: tab became hidden')
  }
  document.addEventListener('visibilitychange', visibility)
  try {
    for (let i = 0; i < 60; i++) { check(); await nextFrame(); await r.frame(true) }
    const warmPositions = (await r.backend.read()).positions
    fit(r, warmPositions); const warmup = measureQuality(r, warmPositions, r.data.input.points); await r.frame(false)
    const intervals: number[] = []; let previous = await nextFrame(); const start = previous
    for (let i = 0; i < 300; i++) {
      check()
      await r.frame(true); const now = await nextFrame(); intervals.push(now - previous); previous = now
      if (i % 60 === 0) progress(`Measuring frame ${i + 1}/300`)
    }
    progress('Checking quality, interaction and rendered samples outside frame timing')
    const endPositions = (await r.backend.read()).positions
    const end = measureQuality(r, endPositions, warmPositions)
    await r.frame(true) // One untimed residual-motion probe; no acceptance threshold is invented.
    const residual = measureQuality(r, (await r.backend.read()).positions, endPositions)
    const interactions = await interactionCheck(r); const validation = await validateFrame(r)
    check()
    return {
      workload: { kind: r.data.kind, count: r.data.input.points.length / 4 },
      links: r.data.graph.links.length / 2,
      frames: percentiles(intervals),
      within33: intervals.filter(v => v <= 33).length / intervals.length,
      intervals,
      frameCount: intervals.length,
      durationMs: previous - start,
      interactions,
      validation,
      quality: { warmup, end, residual },
      info: r.info,
      viewport: [r.canvas.width, r.canvas.height, r.renderer.ratio],
      tick: r.tick,
      visible: document.visibilityState === 'visible',
    }
  } finally { document.removeEventListener('visibilitychange', visibility) }
}
