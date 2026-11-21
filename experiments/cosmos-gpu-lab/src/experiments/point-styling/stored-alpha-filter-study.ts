import { median } from '../weighted-links/timing'
import type { Backend, Snapshot } from './backend'
import { DEFAULTS } from './data'
import { storedAlphaCostPoints, STORED_ALPHA_COST_POLICY } from './stored-alpha-cost'
import type { StoredAlphaTiming } from './stored-alpha-timing'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

export type FilteredAlphaCostRow = {
  lane: string; device: string; count: number; overlapping: number; candidates: number;
  prototypePasses: number; filteredPasses: number; valid: boolean; recordedAt: string;
  prototype: StoredAlphaTiming[]; filtered: StoredAlphaTiming[];
}
export function assertStoredAlphaMatch (prototype: Snapshot, filtered: Snapshot, original: Snapshot): void {
  if (prototype.width !== filtered.width || prototype.height !== filtered.height || prototype.ids.length !== filtered.ids.length ||
      original.color.length !== prototype.color.length || original.color.length !== filtered.color.length) throw new Error('Snapshot dimensions changed')
  if (!filtered.ids.every((value, i) => value === prototype.ids[i])) throw new Error('Filtered picking changed exact IDs')
  for (const image of [prototype, filtered]) {
    if (!image.color.every((value, i) => value === original.color[i])) throw new Error('Stored-alpha picking changed original colors')
  }
}
export async function measureFilteredAlphaCase (
  backend: Backend, lane: string, count: number, dense: boolean, cancelled: () => boolean, pairs = 5
): Promise<FilteredAlphaCostRow | undefined> {
  if (!Number.isInteger(count) || count < 2 || count > 1024 || !Number.isInteger(pairs) || pairs < 1 || pairs > 10) {
    throw new Error('Filtered timing case exceeds the bounded stored-alpha policy')
  }
  const points = storedAlphaCostPoints(count, dense); const region = STORED_ALPHA_COST_POLICY.region
  const original = await backend.render(points, DEFAULTS, false, 'explicit', false)
  const row: FilteredAlphaCostRow = {
    lane,
    device: backend.info,
    count,
    overlapping: dense ? count : Math.min(4, count),
    candidates: 0,
    prototypePasses: 0,
    filteredPasses: 0,
    valid: false,
    recordedAt: '',
    prototype: [],
    filtered: [],
  }
  for (let pair = 0; pair < pairs + 2; pair++) {
    if (cancelled()) return undefined
    if (document.visibilityState !== 'visible') throw new Error('Keep the timing page visible; background timings are rejected')
    const images = {} as Record<'prototype' | 'filtered', Snapshot>
    for (const candidate of pair % 2 ? ['filtered', 'prototype'] as const : ['prototype', 'filtered'] as const) {
      images[candidate] = await backend.render(points, DEFAULTS, false, 'explicit', false,
        { region, measure: 'wall', ...(candidate === 'filtered' ? { candidate } : {}) })
      if (pair >= 2) row[candidate].push(images[candidate].storedAlpha!.timing!)
    }
    assertStoredAlphaMatch(images.prototype, images.filtered, original)
    row.candidates = images.filtered.storedAlpha!.candidateCount
    row.prototypePasses = images.prototype.storedAlpha!.passes; row.filteredPasses = images.filtered.storedAlpha!.passes
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  row.valid = true; row.recordedAt = new Date().toISOString()
  return row
}
export function summarizeFilteredAlpha (row: FilteredAlphaCostRow): Record<string, number> {
  const result: Record<string, number> = {}
  for (const candidate of ['prototype', 'filtered'] as const) {
    for (const field of ['selectionCpuMs', 'setupCpuMs', 'encodeSubmitCpuMs', 'completionWallMs', 'requestWallMs'] as const) {
      result[`${candidate}.${field}`] = median(row[candidate].map(s => s[field]))
    }
  }
  return result
}
export async function runFilteredAlphaCost (
  onRow: (row: FilteredAlphaCostRow) => void | Promise<void>, cancelled: () => boolean, counts: readonly number[] = [16, 64, 256, 1024]
): Promise<void> {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Backend | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const count of counts) {
      for (const dense of [false, true]) {
        const lanes = dense ? [['webgpu', gpu], ['webgl', gl]] as const : [['webgl', gl], ['webgpu', gpu]] as const
        for (const [lane, backend] of lanes) {
          if (cancelled()) return
          const row = await measureFilteredAlphaCase(backend, lane, count, dense, cancelled)
          if (!row) return
          await onRow(row)
        }
      }
    }
  } finally { gpu?.destroy(); gl.destroy() }
}
export function renderFilteredAlphaCost (host: HTMLElement, rows: FilteredAlphaCostRow[]): void {
  host.replaceChildren(); const table = document.createElement('table'); const header = table.createTHead().insertRow()
  for (const label of ['Backend', 'Points / overlap', 'Retained', 'Passes old → filtered', 'Exact outputs',
    'Request wall ms old → filtered', 'Filter + order CPU ms']) {
    const th = document.createElement('th'); th.textContent = label; header.append(th)
  }
  const body = table.createTBody()
  for (const row of rows) {
    const s = summarizeFilteredAlpha(row); const tr = body.insertRow()
    for (const value of [row.lane, `${row.count} / ${row.overlapping}`, row.candidates,
      `${row.prototypePasses} → ${row.filteredPasses}`, row.valid ? 'Pass' : 'Fail',
      `${s['prototype.requestWallMs'].toFixed(3)} → ${s['filtered.requestWallMs'].toFixed(3)}`,
      s['filtered.selectionCpuMs'].toFixed(3)]) tr.insertCell().textContent = String(value)
  }
  host.append(table)
}
