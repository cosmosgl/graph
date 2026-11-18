import { type Integrated, type Feedback, nextFrame } from './runtime'
import { measureQuality } from './quality'
import { interactionCheck, percentiles } from './evaluate'
import { fit, validateFrame } from './validation'
export const settledProtocol = 'Karate Club: 34 points, 78 weighted links, seed 29471, existing corrected forces and hoist springs, ' +
  '5,000 cooling ticks; 960 × 600 logical pixels at actual DPR. Fit at tick 60; no automatic refit during cooling. ' +
  'Measure 300 complete intervals at ticks 61–360 and 5,001–5,300; quality/readbacks outside timing. ' +
  'Record ticks 60/360/2,500/5,000, then manual Fit, all visible point picks, existing interaction sequence, ' +
  'DPR 1/2 and 1.25× zoom pixel audits. Quality is measured only; original frame, feedback and rendering gates stay unchanged.'
type Window = { from: number; to: number; intervals: number[]; frames: ReturnType<typeof percentiles>; within33: number }
type Quality = ReturnType<typeof measureQuality> & { tick: number; fitted: boolean; visiblePoints: number; positions: number[] }
export type SettledRow = {
  settled: true; info: string; viewport: number[]; recordedAt: string;
  windows: Window[]; checkpoints: Quality[]; residual: ReturnType<typeof measureQuality>;
  inventory: { visibleIds: number[]; missingIds: number[]; exactIds: boolean; pick: ReturnType<typeof percentiles>; samples: Feedback[] };
  interactions: Awaited<ReturnType<typeof interactionCheck>>;
  audits: { view: string; validation: Awaited<ReturnType<typeof validateFrame>> }[];
}
export function settledVerdict (r: SettledRow): string {
  const i = r.interactions
  const valid = r.windows.every(w => w.within33 >= 0.95) && r.inventory.exactIds && r.inventory.pick.max <= 50 &&
    i.pick.max <= 50 && i.activePick.max <= 50 && i.drag.max <= 50 && i.exactIds && i.dragPinned && i.pause && i.resume && i.resize &&
    r.audits.every(({ validation: v }) => v.finite && v.paintedSamples > 0 && !v.interiorIdFailures && !v.interiorColorFailures && !v.invisiblePicks)
  return valid ? 'Pass within sampled functional/performance scope; quality measured only' : 'Not accepted; quality measured only'
}
export async function assessSettled (
  r: Integrated, cancelled: () => boolean, progress: (text: string) => void
): Promise<SettledRow> {
  let hidden = document.visibilityState !== 'visible'
  const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  const guard = (): void => {
    if (cancelled()) throw new Error('Settled assessment cancelled')
    if (hidden || document.visibilityState !== 'visible') throw new Error('Settled assessment invalidated: tab became hidden')
  }
  document.addEventListener('visibilitychange', visibility)
  const ratio = devicePixelRatio; const checkpoints: Quality[] = []; const windows: Window[] = []
  const audits: SettledRow['audits'] = []
  let previousPositions: Float32Array
  const checkpoint = async (fitted: boolean): Promise<Float32Array> => {
    const points = (await r.backend.read()).positions
    const visiblePoints = Array.from({ length: points.length / 4 }, (_, i) => r.screen(points[i * 4], points[i * 4 + 1]))
      .filter(([x, y]) => x >= 0 && y >= 0 && x < r.canvas.width && y < r.canvas.height).length
    checkpoints.push({ ...measureQuality(r, points, previousPositions), tick: r.tick, fitted, visiblePoints, positions: Array.from(points) })
    previousPositions = points; return points
  }
  const advance = async (to: number): Promise<void> => {
    while (r.tick < to) {
      guard(); await nextFrame(); await r.frame(true)
      if (r.tick % 120 === 0) progress(`Cooling Karate Club · tick ${r.tick}/5000`)
    }
  }
  const measure = async (): Promise<void> => {
    const from = r.tick + 1; const intervals: number[] = []; let previous = await nextFrame()
    for (let i = 0; i < 300; i++) {
      guard(); await r.frame(true); const stamp = await nextFrame(); intervals.push(stamp - previous); previous = stamp
      if (i % 60 === 0) progress(`Karate Club · measuring ticks ${from}–${from + 299} · ${i + 1}/300`)
    }
    windows.push({ from, to: r.tick, intervals, frames: percentiles(intervals), within33: intervals.filter(v => v <= 33).length / intervals.length })
  }
  try {
    r.pause(); r.resize(960, 600, ratio); await r.replace('karate', 34)
    previousPositions = r.data.input.points
    await advance(60); fit(r, (await r.backend.read()).positions); await r.frame(false); await checkpoint(true)
    await measure(); await checkpoint(false)
    await advance(2500); await checkpoint(false)
    await advance(5000); const cooled = await checkpoint(false)
    // Record the actual framing limit before a deliberate manual-equivalent fit.
    audits.push({ view: 'Tick 5000 · original tick-60 framing', validation: await validateFrame(r) })
    fit(r, cooled); await r.frame(false); await checkpoint(true)
    await measure(); const final = await checkpoint(false)
    await r.frame(true); const residual = measureQuality(r, (await r.backend.read()).positions, final)
    // Restore the recorded geometry for exploration; this is outside timed/quality windows.
    r.backend.setPositions(final); r.renderer.selected = -1; fit(r, final); await r.frame(false)
    progress('Checking every visible point, dragging, camera and DPR outside timing')
    const image = await r.renderer.snapshot(); const sites = new Map<number, { x: number; y: number; distance: number }>()
    for (let offset = 0; offset < image.ids.length; offset += 4) {
      const encoded = image.ids[offset] + image.ids[offset + 1] * 256 + image.ids[offset + 2] * 65536
      if (!encoded) continue
      const id = encoded - 1; const x = offset / 4 % image.width; const y = Math.floor(offset / 4 / image.width)
      const center = r.screen(final[id * 4], final[id * 4 + 1]); const distance = Math.hypot(x + 0.5 - center[0], y + 0.5 - center[1])
      if (!sites.has(id) || distance < sites.get(id)!.distance) sites.set(id, { x, y, distance })
    }
    const visibleIds = [...sites.keys()].sort((a, b) => a - b); let exactIds = true; const first = r.feedback.length
    for (const id of visibleIds) {
      guard(); r.renderer.selected = -1; const site = sites.get(id)!
      if (await r.pick(site.x, site.y) !== id) exactIds = false
    }
    const inventory = {
      visibleIds,
      missingIds: Array.from({ length: 34 }, (_, i) => i).filter(id => !sites.has(id)),
      exactIds,
      pick: percentiles(r.feedback.slice(first).map(f => f.ms)),
      samples: r.feedback.slice(first),
    }
    const interactions = await interactionCheck(r); guard(); r.pause(); r.backend.setPositions(final); r.renderer.selected = -1
    for (const dpr of [1, 2]) {
      r.resize(960, 600, dpr); fit(r, final); await r.frame(false)
      audits.push({ view: `Fitted · DPR ${dpr}`, validation: await validateFrame(r) }); guard()
      r.zoom(1.25, r.canvas.width / 2, r.canvas.height / 2); r.pan(24 * dpr, 12 * dpr); await r.frame(false)
      audits.push({ view: `1.25× zoom + pan · DPR ${dpr}`, validation: await validateFrame(r) }); guard()
    }
    r.resize(960, 600, ratio); fit(r, final); await r.frame(false)
    return {
      settled: true,
      info: r.info,
      viewport: [r.canvas.width, r.canvas.height, r.renderer.ratio],
      recordedAt: new Date().toISOString(),
      windows,
      checkpoints,
      residual,
      inventory,
      interactions,
      audits,
    }
  } finally { r.pause(); document.removeEventListener('visibilitychange', visibility) }
}
