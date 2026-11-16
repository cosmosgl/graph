import { pick, type Backend } from './backend'
import { alphaBoundarySamples } from './alpha-conversion'
import { DEFAULTS, point } from './data'
import { compareColors } from './reference'
import { cropRegion } from './stored-alpha'

export type StoredAlphaRow = {
  scene: string; backend: string; ownAlpha: number; sourceByteId: number | null; storedId: number | null;
  changedColors: number; cpuMismatches: number; invisiblePicks: number; passes: number;
}
// Fixed replay independent of the live controls and any installed image atlas.
export async function storedAlphaReplay (backend: Backend): Promise<StoredAlphaRow[]> {
  const boundary = alphaBoundarySamples()[3]
  const foreground = (alpha: number): ReturnType<typeof point> => point(256.5, 160.5, 0, { size: 8, color: [0.9, 0.3, 0.1, alpha] })
  const background = point(256.5, 160.5, 1, { size: 24, color: [0.2, 0.6, 0.9, 1] })
  const cases = [
    { name: 'Boundary alone', points: [foreground(boundary)] },
    { name: 'Boundary over visible point', points: [background, foreground(boundary)] },
    { name: 'Invisible over visible point', points: [background, foreground(1 / 65536)] },
  ]
  const region = { x: 250, y: 154, width: 14, height: 14 }; const rows: StoredAlphaRow[] = []
  for (const scene of cases) {
    const original = await backend.render(scene.points, DEFAULTS, false, 'explicit', false)
    const sourceByte = await backend.render(scene.points, DEFAULTS, false, 'eligibility', false)
    const stored = await backend.render(scene.points, DEFAULTS, false, 'explicit', false, { region, audit: true })
    const trace = stored.storedAlpha!; const local = cropRegion(stored.ids, stored.width, region)
    let cpuMismatches = 0; let invisiblePicks = 0
    for (let offset = 0; offset < local.length; offset += 4) {
      if (local.subarray(offset, offset + 4).some((v, c) => v !== trace.cpuIds![offset + c])) cpuMismatches++
      const id = local[offset] + local[offset + 1] * 256 + local[offset + 2] * 65536 - 1
      if (id >= 0 && !trace.layers.find(layer => layer.id === id)?.paint[offset + 3]) invisiblePicks++
    }
    rows.push({
      scene: scene.name,
      backend: backend.info,
      ownAlpha: trace.layers.at(-1)!.paint[((160 - region.y) * region.width + 256 - region.x) * 4 + 3],
      sourceByteId: pick(sourceByte, 256, 160),
      storedId: pick(stored, 256, 160),
      changedColors: compareColors(original, stored).changedPixels,
      cpuMismatches,
      invisiblePicks,
      passes: trace.passes,
    })
  }
  return rows
}
export function renderStoredAlphaRows (host: HTMLElement, rows: Array<StoredAlphaRow & { lane: string }>): void {
  host.replaceChildren()
  const table = document.createElement('table')
  const header = table.createTHead().insertRow()
  for (const label of ['Backend / scene', 'Own alpha byte', 'Source-byte ID', 'Stored-alpha ID', 'Colors changed', 'CPU mismatches', 'Invisible picks']) {
    const cell = document.createElement('th'); cell.textContent = label; header.append(cell)
  }
  const body = table.createTBody()
  for (const row of rows) {
    const tr = body.insertRow()
    for (const value of [`${row.lane} · ${row.scene}`, row.ownAlpha, row.sourceByteId ?? 'None', row.storedId ?? 'None',
      row.changedColors, row.cpuMismatches, row.invisiblePicks]) tr.insertCell().textContent = String(value)
  }
  host.append(table)
}
