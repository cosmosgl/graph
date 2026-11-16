import { median } from '../weighted-links/timing'
import type { Backend, Snapshot } from './backend'
import { DEFAULTS, point, type Point } from './data'
import { compareColors, referencePick } from './reference'
import { cropRegion } from './stored-alpha'
import type { StoredAlphaTiming } from './stored-alpha-timing'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

export const STORED_ALPHA_COST_POLICY = {
  pickingPolicy: 'stored-alpha-v1',
  counts: [16, 64, 256, 1024],
  distributions: ['four-overlapping', 'all-overlapping'],
  warmupPairs: 2,
  measuredPairs: 5,
  region: { x: 250, y: 154, width: 14, height: 14 },
  frame: [512, 320],
  sampleRule: 'Alternate wall-only/profiled order; per-pass GPU sums include clears; no per-point audit readback',
} as const
export type StoredAlphaCostRow = {
  count: number; overlapping: number; lane: 'webgl' | 'webgpu'; device: string; passes: number; scratchBytes: number;
  startedAt: string; finishedAt: string; valid: boolean;
  normal: StoredAlphaTiming[]; profiled: StoredAlphaTiming[];
}
export function storedAlphaCostPoints (count: number, dense: boolean): Point[] {
  const overlap = dense ? count : Math.min(4, count)
  return Array.from({ length: count }, (_, id) => point(id < overlap ? 256.5 : 32.5 + (id % 32),
    id < overlap ? 160.5 : 32.5 + (Math.floor(id / 32) % 32), 0, {
      size: 8, color: [0.62, 0.71, 0.84, id === overlap - 1 ? 1 / 65536 : 1],
    }))
}
function assertCostFrame (image: Snapshot, original: Snapshot, expectedIds: Uint8Array): void {
  const region = STORED_ALPHA_COST_POLICY.region
  if (compareColors(original, image).changedPixels) throw new Error('Timing changed original color bytes')
  const local = cropRegion(image.ids, image.width, region)
  if (!local.every((v, i) => v === expectedIds[i])) throw new Error('Timing changed exact region IDs')
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if ((x < region.x || x >= region.x + region.width || y < region.y || y >= region.y + region.height) &&
          image.ids[(y * image.width + x) * 4 + 3]) throw new Error('Timing left an ID outside the region')
    }
  }
}
export async function measureStoredAlphaCase (
  backend: Backend, lane: 'webgl' | 'webgpu', count: number, dense: boolean, cancelled: () => boolean = (): boolean => false,
  pairs: number = STORED_ALPHA_COST_POLICY.measuredPairs
): Promise<StoredAlphaCostRow | undefined> {
  if (!Number.isInteger(count) || count < 2 || count > 1024 || !Number.isInteger(pairs) || pairs < 1 || pairs > 10) {
    throw new Error('Stored-alpha timing case exceeds its bounded policy')
  }
  const startedAt = new Date().toISOString(); const points = storedAlphaCostPoints(count, dense)
  const original = await backend.render(points, DEFAULTS, false, 'explicit', false)
  const region = STORED_ALPHA_COST_POLICY.region
  const expectedIds = new Uint8Array(region.width * region.height * 4)
  // This workload has only opaque bodies and an unambiguously invisible source.
  // Its scalar source-byte and stored-alpha rules agree; boundary floats have
  // their separate attachment-aware regression, never a changed CPU expectation.
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const id = referencePick(points, DEFAULTS, region.x + x + 0.5, region.y + y + 0.5, 'source-alpha')
      if (id !== null) { const value = id + 1; expectedIds.set([value & 255, (value >> 8) & 255, (value >> 16) & 255, 255], (y * region.width + x) * 4) }
    }
  }
  const normal: StoredAlphaTiming[] = []; const profiled: StoredAlphaTiming[] = []
  for (let pair = 0; pair < pairs + STORED_ALPHA_COST_POLICY.warmupPairs; pair++) {
    for (const mode of pair % 2 ? ['gpu', 'wall'] as const : ['wall', 'gpu'] as const) {
      if (cancelled()) return undefined
      if (document.visibilityState !== 'visible') throw new Error('Keep the timing page visible; background timings are rejected')
      const image = await backend.render(points, DEFAULTS, false, 'explicit', false, { region, measure: mode })
      assertCostFrame(image, original, expectedIds)
      const timing = image.storedAlpha!.timing!
      if (pair >= STORED_ALPHA_COST_POLICY.warmupPairs) (mode === 'wall' ? normal : profiled).push(timing)
      // Allow cancellation/UI updates between complete, validated requests.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  return {
    count,
    overlapping: dense ? count : Math.min(4, count),
    lane,
    device: backend.info,
    startedAt,
    finishedAt: new Date().toISOString(),
    passes: 1 + count * 3,
    scratchBytes: normal[0].scratchBytes,
    valid: true,
    normal,
    profiled,
  }
}
export async function runStoredAlphaCost (
  onRow: (row: StoredAlphaCostRow) => void, cancelled: () => boolean, counts: readonly number[] = STORED_ALPHA_COST_POLICY.counts
): Promise<void> {
  const gl = await createStylingWebGL(document.createElement('canvas'), undefined, true)
  let gpu: Backend | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'), undefined, true)
    for (const count of counts) {
      for (const dense of [false, true]) {
        for (const [lane, backend] of (dense ? [['webgpu', gpu], ['webgl', gl]] : [['webgl', gl], ['webgpu', gpu]]) as
          Array<['webgl' | 'webgpu', Backend]>) {
          if (cancelled()) return
          const row = await measureStoredAlphaCase(backend, lane, count, dense, cancelled)
          if (!row) return
          onRow(row)
        }
      }
    }
  } finally { gpu?.destroy(); gl.destroy() }
}
export function summarizeStoredAlphaCost (row: StoredAlphaCostRow): {
  setup: number; submit: number; completion: number; readback: number; gpu: number | null; profileOverhead: number;
} {
  return {
    setup: median(row.normal.map(s => s.setupCpuMs)),
    submit: median(row.normal.map(s => s.encodeSubmitCpuMs)),
    completion: median(row.normal.map(s => s.completionWallMs)),
    readback: median(row.normal.map(s => s.frameReadbackWallMs!)),
    gpu: row.profiled.every(s => s.timerStatus === 'valid' && s.gpuMs !== null) ? median(row.profiled.map(s => s.gpuMs!)) : null,
    profileOverhead: median(row.profiled.map((s, i) => s.completionWallMs - row.normal[i].completionWallMs)),
  }
}
export function renderStoredAlphaCost (host: HTMLElement, rows: StoredAlphaCostRow[]): void {
  host.replaceChildren(); const table = document.createElement('table'); const header = table.createTHead().insertRow()
  for (const label of ['Backend', 'Points / overlap', 'Passes', 'Setup CPU ms', 'Encode + submit ms', 'Completion wall ms',
    'Snapshot readback ms', 'Profiled GPU sum ms', 'Profiling added wall ms']) {
    const th = document.createElement('th'); th.textContent = label; header.append(th)
  }
  const body = table.createTBody()
  for (const row of rows) {
    const s = summarizeStoredAlphaCost(row); const tr = body.insertRow()
    const rejected = row.profiled.filter(sample => sample.timerStatus !== 'valid')
    const status = [...new Set(rejected.map(sample => sample.timerStatus))].join(', ')
    const gpu = s.gpu === null ? `${status} (${rejected.length}/${row.profiled.length})` : s.gpu.toFixed(3)
    for (const value of [row.lane, `${row.count} / ${row.overlapping}`, row.passes, s.setup.toFixed(3), s.submit.toFixed(3),
      s.completion.toFixed(3), s.readback.toFixed(3), gpu, s.profileOverhead.toFixed(3)]) {
      tr.insertCell().textContent = String(value)
    }
  }
  host.append(table)
}
