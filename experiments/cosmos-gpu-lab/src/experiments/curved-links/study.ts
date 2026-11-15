import { compareColors, type ColorResult } from '../straight-links/reference'
import type { Backend, Snapshot } from './backend'
import { DEFAULTS, FIXTURES, PROFILES, fixture, type Scene, type Settings, type Variant, type Fixture } from './data'
import { compare, reference, type Comparison } from './reference'
export type Pair = { webgl: Snapshot; webgpu: Snapshot }
export type Visibility = { webgl: number; webgpu: number; unknown: { webgl: number; webgpu: number }; checked: { webgl: number[]; webgpu: number[] } }
async function sourceVisibility (backends: { webgl: Backend; webgpu: Backend }, pair: Pair, scene: Scene,
  settings: Settings, variant: Variant): Promise<Visibility> {
  const result: Visibility = { webgl: 0, webgpu: 0, unknown: { webgl: 0, webgpu: 0 }, checked: { webgl: [], webgpu: [] } }
  for (const lane of ['webgl', 'webgpu'] as const) {
    const image = pair[lane]; const ids = new Set<number>()
    const idAt = (i: number): number => image.ids[i] + image.ids[i + 1] * 256 + image.ids[i + 2] * 65536 - 1
    for (let i = 0; i < image.ids.length; i += 4) {
      const id = idAt(i)
      if (id < 0) continue
      const index = id - settings.indexOffset
      if (index < 0 || index >= scene.links.length) result.unknown[lane]++
      else ids.add(index)
    }
    for (const id of ids) {
      result.checked[lane].push(id)
      const input = { ...scene, links: scene.links.map((l, i) => i === id ? l : { ...l, width: 0 }) }
      const isolated = await backends[lane].render(input, settings, variant, false)
      for (let i = 0; i < image.ids.length; i += 4) {
        if (idAt(i) === id + settings.indexOffset && isolated.color[i + 3] === 0) result[lane]++
      }
    }
  }
  return result
}
export type Evidence = { triangles: number; production: Comparison; candidate: Comparison; compatibility: Comparison;
  preservation: { webgl: ColorResult; webgpu: ColorResult }; sourceVisibility: { production: Visibility; candidate: Visibility };
  productionPassed: boolean; passed: boolean; }
export async function assess (backends: { webgl: Backend; webgpu: Backend }, scene: Scene, settings: Settings,
  display?: Variant): Promise<{ frames: Record<Variant, Pair>; evidence: Evidence }> {
  const frames: Record<Variant, Pair> = {
    production: {
      webgl: await backends.webgl.render(scene, settings, 'production', display === 'production'),
      webgpu: await backends.webgpu.render(scene, settings, 'production', display === 'production'),
    },
    visible: {
      webgl: await backends.webgl.render(scene, settings, 'visible', display === 'visible'),
      webgpu: await backends.webgpu.render(scene, settings, 'visible', display === 'visible'),
    },
  }
  const ref = reference(scene, settings)
  const production = await compare(frames.production.webgl, frames.production.webgpu, ref)
  const candidate = await compare(frames.visible.webgl, frames.visible.webgpu, ref)
  const compatibility = await compare(frames.production.webgl, frames.visible.webgpu, ref)
  const preservation = {
    webgl: compareColors(frames.production.webgl.color, frames.visible.webgl.color),
    webgpu: compareColors(frames.production.webgpu.color, frames.visible.webgpu.color),
  }
  const sources = {
    production: await sourceVisibility(backends, frames.production, scene, settings, 'production'),
    candidate: await sourceVisibility(backends, frames.visible, scene, settings, 'visible'),
  }
  const sourcePass = (v: Visibility): boolean => v.webgl + v.webgpu + v.unknown.webgl + v.unknown.webgpu === 0
  return {
    frames,
    evidence: {
      triangles: ref.triangles,
      production,
      candidate,
      compatibility,
      preservation,
      sourceVisibility: sources,
      productionPassed: production.passed && sourcePass(sources.production),
      passed: candidate.passed && preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0 && sourcePass(sources.candidate),
    },
  }
}
export const ROW_COUNT = FIXTURES.length * PROFILES.length * 2
export type Row = Evidence & { fixture: Fixture; profile: string; settings: Settings }
export async function runSweep (backends: { webgl: Backend; webgpu: Backend }, onRow: (row: Row) => void,
  cancelled: () => boolean): Promise<Row[]> {
  const rows: Row[] = []
  for (const name of FIXTURES) {
    for (const profile of PROFILES) {
      for (const blend of [true, false]) {
        if (cancelled()) return rows
        const settings = { ...DEFAULTS, ...profile.settings, blend }; const { evidence } = await assess(backends, fixture(name), settings)
        const row: Row = { fixture: name, profile: profile.name, settings, ...evidence }
        rows.push(row); onRow(row); await new Promise<void>(resolve => { setTimeout(resolve, 0) })
      }
    }
  }
  return rows
}
export function renderRows (host: HTMLElement, rows: Row[]): void {
  host.innerHTML = `<p>${rows.filter(r => r.passed).length} passed / ${rows.length} checked of ${ROW_COUNT} configurations.
    Every original control and rejection remains included.</p>
    <table data-curves-summary><thead><tr><th>Scene</th><th>Candidate passed / checked</th><th>Production passed</th></tr></thead><tbody>
    ${FIXTURES.map(name => {
    const selected = rows.filter(r => r.fixture === name)
    return `<tr><td>${name}</td><td>${selected.filter(r => r.passed).length} / ${selected.length}</td>
      <td>${selected.filter(r => r.productionPassed).length}</td></tr>`
  }).join('')}</tbody></table>
    <table data-curves-sweep><thead><tr><th>Scene / profile / mode</th><th>Candidate</th><th>IDs</th><th>CPU masks · GL / GPU</th>
      <th>Color failures · pair / CPU GL / CPU GPU</th><th>Invisible · frame / source</th><th>Changed original color · GL / GPU</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.fixture} · ${r.profile}<br>${r.settings.blend ? 'Blended' : 'Hard opaque'}</td><td>${r.passed ? 'Pass' : 'Fail'}</td>
      <td>${r.candidate.idDifferences}</td><td>${r.candidate.masks.webgl} / ${r.candidate.masks.webgpu}</td>
      <td>${r.candidate.colors.budgetFailures} / ${r.candidate.cpuColors.webgl.budgetFailures} / ${r.candidate.cpuColors.webgpu.budgetFailures}</td>
      <td>${r.candidate.invisible.webgl + r.candidate.invisible.webgpu} / ${r.sourceVisibility.candidate.webgl + r.sourceVisibility.candidate.webgpu}</td>
      <td>${r.preservation.webgl.changedPixels} / ${r.preservation.webgpu.changedPixels}</td></tr>`).join('')}</tbody></table>`
}
