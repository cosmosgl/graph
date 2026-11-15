import type { Backend, Snapshot } from './backend'
import { compareColors, compareSnapshotsAsync, type ColorComparison, type Comparison } from './reference'
import { effectsCpuColors } from './effects-reference'
import { effectScenario, EFFECTS_FIXTURES, EFFECTS_PROFILES, EFFECTS_VIEWS, type EffectsFixture } from './effects-fixtures'

export const EFFECTS_ROW_COUNT = EFFECTS_FIXTURES.length * EFFECTS_PROFILES.length * EFFECTS_VIEWS.length
export type EffectsRow = {
  fixture: EffectsFixture; profile: string; view: string; points: ReturnType<typeof effectScenario>['points'];
  settings: ReturnType<typeof effectScenario>['settings']; paired: Comparison; production: Comparison; compatibility: Comparison;
  colors: { webgl: ColorComparison; webgpu: ColorComparison }; preservation: { webgl: ColorComparison; webgpu: ColorComparison };
  overlayIdDifferences: { webgl: number; webgpu: number }; passed: boolean;
}
export async function runEffectsSweep (
  backends: { webgl: Backend; webgpu: Backend }, onRow: (row: EffectsRow) => void, cancelled: () => boolean,
  views = EFFECTS_VIEWS
): Promise<EffectsRow[]> {
  const rows: EffectsRow[] = []
  for (const fixture of EFFECTS_FIXTURES) {
    for (const [index, EFFECTS_PROFILE] of EFFECTS_PROFILES.entries()) {
      for (const view of views) {
        if (cancelled()) return rows
        const { points, settings } = effectScenario(fixture, index, view.settings)
        const render = async (variant: 'production' | 'explicit' | 'eligibility', overlays = true): Promise<{ webgl: Snapshot; webgpu: Snapshot }> => {
          const config = overlays ? settings : { ...settings, hovered: [], focused: undefined }
          return {
            webgl: await backends.webgl.render(points, config, false, variant, false),
            webgpu: await backends.webgpu.render(points, config, false, variant, false),
          }
        }
        const production = await render('production'); const explicit = await render('explicit')
        const candidate = await render('eligibility'); const noOverlays = await render('eligibility', false)
        const paired = await compareSnapshotsAsync(candidate.webgl, candidate.webgpu, points, settings)
        const colors = { webgl: effectsCpuColors(candidate.webgl, points, settings), webgpu: effectsCpuColors(candidate.webgpu, points, settings) }
        const preservation = { webgl: compareColors(explicit.webgl, candidate.webgl), webgpu: compareColors(explicit.webgpu, candidate.webgpu) }
        const differences = (a: Snapshot, b: Snapshot): number => {
          let count = 0
          for (let i = 0; i < a.ids.length; i += 4) if (a.ids.subarray(i, i + 4).some((value, c) => value !== b.ids[i + c])) count++
          return count
        }
        const overlayIdDifferences = {
          webgl: differences(candidate.webgl, noOverlays.webgl), webgpu: differences(candidate.webgpu, noOverlays.webgpu),
        }
        const row: EffectsRow = {
          fixture,
          profile: EFFECTS_PROFILE.name,
          view: view.name,
          points,
          settings,
          paired,
          colors,
          preservation,
          overlayIdDifferences,
          production: await compareSnapshotsAsync(production.webgl, production.webgpu, points, settings),
          compatibility: await compareSnapshotsAsync(production.webgl, candidate.webgpu, points, settings),
          passed: paired.valid && colors.webgl.budgetFailures === 0 && colors.webgpu.budgetFailures === 0 &&
        preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0 &&
        overlayIdDifferences.webgl === 0 && overlayIdDifferences.webgpu === 0,
        }
        rows.push(row); onRow(row); await new Promise<void>(resolve => { setTimeout(resolve, 0) })
      }
    }
  }
  return rows
}
export function renderEffectsRows (host: HTMLElement, rows: EffectsRow[]): void {
  host.innerHTML = `<p>${rows.filter(r => r.passed).length} passed / ${rows.length} checked of ${EFFECTS_ROW_COUNT} rows.
    Exact IDs and CPU masks, 2/255 color budget and zero invisible picks. Decorative overlays must leave IDs unchanged;
    source-byte picking must leave color bytes unchanged. Production compatibility is reported separately.</p>
    <table data-effects-summary><thead><tr><th>Scene</th><th>Passed / checked</th><th>CPU color failures</th><th>Overlay ID changes</th></tr></thead><tbody>
    ${EFFECTS_FIXTURES.map(name => {
    const selected = rows.filter(r => r.fixture === name)
    return `<tr><td>${name}</td><td>${selected.filter(r => r.passed).length} / ${selected.length}</td>
      <td>${selected.reduce((sum, r) => sum + r.colors.webgl.budgetFailures + r.colors.webgpu.budgetFailures, 0)}</td>
      <td>${selected.reduce((sum, r) => sum + r.overlayIdDifferences.webgl + r.overlayIdDifferences.webgpu, 0)}</td></tr>`
  }).join('')}</tbody></table>
    <table data-effects-table><thead><tr><th>Scene / profile / view</th><th>Result</th><th>ID differences</th><th>CPU masks · GL / GPU</th>
      <th>CPU color failures · GL / GPU</th><th>Production compatible</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.fixture} · ${r.profile}<br>${r.view}</td><td>${r.passed ? 'Pass' : 'Fail'}</td>
      <td>${r.paired.idDisagreements}</td><td>${r.paired.webglReferenceFailures} / ${r.paired.webgpuReferenceFailures}</td>
      <td>${r.colors.webgl.budgetFailures} / ${r.colors.webgpu.budgetFailures}</td><td>${r.compatibility.valid ? 'Pass' : 'Fail'}</td></tr>`).join('')}
    </tbody></table>`
}
