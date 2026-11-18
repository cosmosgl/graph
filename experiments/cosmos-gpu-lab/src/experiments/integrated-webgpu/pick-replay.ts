import type { Feedback, Integrated } from './runtime'
import { percentiles } from './evaluate'
import { fit, validateFrame } from './validation'

export const pickReplayProtocol = 'Paused Karate Club, retained tick-5300 geometry from a local settled assessment; ' +
  '960 × 600 logical pixels at actual DPR, original styles and manual Fit. Three fixed sweeps: ascending, descending, ascending IDs. ' +
  'No pick warmup or discarded first request. Retain every ID and readback/highlight/next-frame phase; exact IDs and 50-ms maximum unchanged. ' +
  'Validate pixels and unchanged positions outside picking timing. This is a frozen-geometry replay, not a new cooling or frame-performance run.'
export type CooledCapture = { recordedAt: string; info: string; positions: number[] }
export type PickReplayRow = {
  pickReplay: true; recordedAt: string; info: string; viewport: number[]; source: CooledCapture;
  samples: (Feedback & { sweep: number; expectedId: number; x: number; y: number })[];
  missingIds: number[]; complete: boolean; interruption: string; samePositions: boolean;
  validation?: Awaited<ReturnType<typeof validateFrame>>;
}
export function parseCooledCapture (text: string): CooledCapture {
  const capture = JSON.parse(text)
  const row = capture.records?.findLast((r: { settled?: boolean }) => r?.settled === true)
  const checkpoint = row?.checkpoints?.find((c: { tick?: number }) => c.tick === 5300)
  const positions = checkpoint?.positions
  if (typeof row?.recordedAt !== 'string' || typeof row?.info !== 'string' || !Array.isArray(positions) ||
    positions.length !== 34 * 4 || !positions.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6)) {
    throw new Error('Choose a lab Export JSON containing a settled Karate Club tick-5300 checkpoint')
  }
  return { recordedAt: row.recordedAt, info: row.info, positions }
}
export function pickReplayVerdict (r: PickReplayRow): string {
  const v = r.validation
  return r.complete && !r.missingIds.length && r.samples.length === 102 && r.samePositions &&
    r.samples.every(s => s.id === s.expectedId && s.ms <= 50) && v?.finite && v.paintedSamples > 0 &&
    !v.interiorIdFailures && !v.interiorColorFailures && !v.invisiblePicks
    ? 'Pass within paused replay scope'
    : 'Not accepted'
}
export function replaySummary (r: PickReplayRow): { sweep: number; count: number; first: number; worst: PickReplayRow['samples'][number]; p95: number }[] {
  return [1, 2, 3].flatMap(sweep => {
    const samples = r.samples.filter(s => s.sweep === sweep)
    return samples.length
      ? [{
        sweep,
        count: samples.length,
        first: samples[0].ms,
        worst: samples.reduce((a, b) => a.ms >= b.ms ? a : b),
        p95: percentiles(samples.map(s => s.ms)).p95,
      }]
      : []
  })
}
export async function replayCooledPicking (
  r: Integrated, source: CooledCapture, cancelled: () => boolean
): Promise<PickReplayRow> {
  const row: PickReplayRow = {
    pickReplay: true,
    recordedAt: new Date().toISOString(),
    info: r.info,
    viewport: [],
    source,
    samples: [],
    missingIds: [],
    complete: false,
    interruption: '',
    samePositions: false,
  }
  let hidden = document.visibilityState !== 'visible'
  const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  const guard = (): void => {
    if (cancelled()) throw new Error('Replay cancelled; completed samples retained')
    if (hidden) throw new Error('Replay invalidated: tab became hidden')
  }
  document.addEventListener('visibilitychange', visibility)
  try {
    guard(); r.pause(); r.resize(960, 600, devicePixelRatio); await r.replace('karate', 34)
    const positions = new Float32Array(source.positions)
    r.backend.setPositions(positions); r.renderer.selected = -1; fit(r, positions); await r.frame(false)
    row.viewport = [r.canvas.width, r.canvas.height, r.renderer.ratio]
    const image = await r.renderer.snapshot()
    const sites = new Map<number, { x: number; y: number; distance: number }>()
    for (let offset = 0; offset < image.ids.length; offset += 4) {
      const encoded = image.ids[offset] + image.ids[offset + 1] * 256 + image.ids[offset + 2] * 65536
      if (!encoded) continue
      const id = encoded - 1; const x = offset / 4 % image.width; const y = Math.floor(offset / 4 / image.width)
      const center = r.screen(positions[id * 4], positions[id * 4 + 1]); const distance = Math.hypot(x + 0.5 - center[0], y + 0.5 - center[1])
      if (!sites.has(id) || distance < sites.get(id)!.distance) sites.set(id, { x, y, distance })
    }
    const ids = Array.from({ length: 34 }, (_, id) => id)
    row.missingIds = ids.filter(id => !sites.has(id))
    for (const sweep of [1, 2, 3]) {
      for (const expectedId of sweep === 2 ? [...ids].reverse() : ids) {
        guard(); const site = sites.get(expectedId); if (!site) continue
        r.renderer.selected = -1
        const first = r.feedback.length; await r.pick(site.x, site.y)
        const sample = r.feedback[first]
        if (!sample) throw new Error('Picking request completed without a feedback sample')
        row.samples.push({ ...sample, sweep, expectedId, x: site.x, y: site.y }); guard()
      }
    }
    const after = (await r.backend.read()).positions
    row.samePositions = after.length === positions.length && after.every((v, i) => Object.is(v, positions[i]))
    r.renderer.selected = -1; await r.frame(false)
    row.validation = await validateFrame(r); guard(); row.complete = true
  } catch (e) { row.interruption = String(e) } finally { r.pause(); document.removeEventListener('visibilitychange', visibility) }
  return row
}
