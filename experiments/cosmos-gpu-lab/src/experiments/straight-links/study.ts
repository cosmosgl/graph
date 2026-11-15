import { pick } from '../../gpu/rgba-readback'
import { DEFAULTS, FIXTURES, PROFILES, fixture, resolveLink, type Scene, type Settings, type Variant, type Fixture } from './data'
import type { Backend, Snapshot } from './backend'
import { compare, compareColors, type Comparison, type ColorResult } from './reference'
export const ROW_COUNT = FIXTURES.length * PROFILES.length * 2
export type Pair = { webgl: Snapshot; webgpu: Snapshot }
export type Contributions = { webgl: number; webgpu: number; sources: number[] }
export async function contributions (backends: { webgl: Backend; webgpu: Backend }, pair: Pair, scene: Scene,
  settings: Settings, variant: Variant): Promise<Contributions> {
  const result: Contributions = { webgl: 0, webgpu: 0, sources: [] }
  for (const [id, link] of scene.links.entries()) {
    const alpha = resolveLink(link, settings).color[3] * settings.opacity
    if (alpha <= 0 || alpha >= 1 / 255) continue
    result.sources.push(id)
    const isolated = { points: scene.points, links: scene.links.map((l, i) => i === id ? l : { ...l, width: 0 }) }
    for (const lane of ['webgl', 'webgpu'] as const) {
      const snapshot = await backends[lane].render(isolated, settings, variant, false)
      for (let y = 0; y < snapshot.height; y++) {
        for (let x = 0; x < snapshot.width; x++) {
          if (pick(pair[lane], x, y) === id + settings.indexOffset && snapshot.color[(y * snapshot.width + x) * 4 + 3] === 0) result[lane]++
        }
      }
    }
  }
  return result
}
export type Row = { fixture: Fixture; profile: string; settings: Settings; production: Comparison; candidate: Comparison;
  compatibility: Comparison; preservation: { webgl: ColorResult; webgpu: ColorResult };
  sourceVisibility: { production: Contributions; candidate: Contributions }; passed: boolean; }
export async function runSweep (backends: { webgl: Backend; webgpu: Backend }, onRow: (row: Row) => void,
  cancelled: () => boolean): Promise<Row[]> {
  const rows: Row[] = []
  for (const name of FIXTURES) {
    for (const profile of PROFILES) {
      for (const blend of [true, false]) {
        if (cancelled()) return rows
        const scene = fixture(name); const settings = { ...DEFAULTS, ...profile.settings, blend }
        const render = async (variant: Variant): Promise<Pair> => ({
          webgl: await backends.webgl.render(scene, settings, variant, false),
          webgpu: await backends.webgpu.render(scene, settings, variant, false),
        })
        const a = await render('production'); const b = await render('visible')
        const production = await compare(a.webgl, a.webgpu, scene, settings); const candidate = await compare(b.webgl, b.webgpu, scene, settings)
        const preservation = { webgl: compareColors(a.webgl.color, b.webgl.color), webgpu: compareColors(a.webgpu.color, b.webgpu.color) }
        const sourceVisibility = {
          production: await contributions(backends, a, scene, settings, 'production'),
          candidate: await contributions(backends, b, scene, settings, 'visible'),
        }
        const row: Row = {
          fixture: name,
          profile: profile.name,
          settings,
          production,
          candidate,
          compatibility: await compare(a.webgl, b.webgpu, scene, settings),
          preservation,
          sourceVisibility,
          passed: candidate.passed && preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0 &&
        sourceVisibility.candidate.webgl === 0 && sourceVisibility.candidate.webgpu === 0,
        }
        rows.push(row); onRow(row); await new Promise<void>(resolve => { setTimeout(resolve, 0) })
      }
    }
  }
  return rows
}
export function renderRows (host: HTMLElement, rows: Row[]): void {
  host.innerHTML = `<p>${rows.filter(r => r.passed).length} passed / ${rows.length} checked of ${ROW_COUNT} cases.
    All production controls and rejected rows remain included.</p>
    <table data-links-summary><thead><tr><th>Scene</th><th>Candidate passed / checked</th><th>Production passed</th></tr></thead><tbody>
    ${FIXTURES.map(name => {
    const selected = rows.filter(r => r.fixture === name); return `<tr><td>${name}</td>
      <td>${selected.filter(r => r.passed).length} / ${selected.length}</td><td>${selected.filter(r => r.production.passed).length}</td></tr>`
  }).join('')}
    </tbody></table>
    <table data-links-sweep><thead><tr><th>Scene / profile / mode</th><th>Candidate</th><th>ID differences</th><th>CPU masks · GL / GPU</th>
      <th>GPU color failures</th><th>CPU color failures · GL / GPU</th><th>Invisible picks · frame / faint source</th>
      <th>Color changed · GL / GPU</th><th>Production / compatible</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.fixture} · ${r.profile}<br>${r.settings.blend ? 'Blended' : 'Hard opaque'}</td><td>${r.passed ? 'Pass' : 'Fail'}</td>
      <td>${r.candidate.idDifferences}</td><td>${r.candidate.masks.webgl} / ${r.candidate.masks.webgpu}</td><td>${r.candidate.colors.budgetFailures}</td>
      <td>${r.candidate.cpuColors.webgl.budgetFailures} / ${r.candidate.cpuColors.webgpu.budgetFailures}</td>
      <td>${r.candidate.invisible.webgl + r.candidate.invisible.webgpu} / ${r.sourceVisibility.candidate.webgl + r.sourceVisibility.candidate.webgpu}</td>
      <td>${r.preservation.webgl.changedPixels} / ${r.preservation.webgpu.changedPixels}</td>
      <td>${r.production.passed ? 'Pass' : 'Fail'} / ${r.compatibility.passed ? 'Pass' : 'Fail'}</td></tr>`).join('')}</tbody></table>`
}
