import type { Backend, Snapshot } from './backend'
import { PACKING_NAMES, packingLayout, type AtlasPacking } from './atlas-packing'
import { inspectAtlasIsolation, type IsolationAudit } from './atlas-isolation'
import { DEFAULTS, fixture, type Settings } from './data'
import { compareColors, compareSnapshotsAsync, type ColorComparison, type Comparison } from './reference'
import { contributionPasses, inspectForeground, type ContributionPair } from './tiny-alpha'

export const PACKING_FIXTURES = ['atlas-packing-edges', 'atlas-packing-overlap'] as const
export const PACKING_POLICIES = ['original', 'clamp', 'texel'] as const
export const PACKING_PROFILES = [
  { name: 'Native', settings: {} },
  { name: 'Retina', settings: { ratio: 2 } },
  { name: 'Zoom out · translucent · reversed', settings: { zoom: 0.5, opacity: 0.35, reverse: true } },
] satisfies Array<{ name: string; settings: Partial<Settings> }>
export const PACKING_ROW_COUNT = PACKING_NAMES.length * PACKING_FIXTURES.length * 2 * PACKING_PROFILES.length * PACKING_POLICIES.length
export type PackingRow = {
  packing: Exclude<AtlasPacking, 'baseline'>; fixture: typeof PACKING_FIXTURES[number]; profile: string;
  filter: 'nearest' | 'linear'; policy: typeof PACKING_POLICIES[number]; settings: Settings;
  production: Comparison; paired: Comparison; isolated: IsolationAudit; compatibility: Comparison; contribution?: ContributionPair;
  preservation: { webgl: ColorComparison; webgpu: ColorComparison }; passed: boolean;
}
export async function runPackingSweep (
  backends: { webgl: Backend; webgpu: Backend }, onRow: (row: PackingRow) => void, cancelled: () => boolean
): Promise<PackingRow[]> {
  const rows: PackingRow[] = []
  const render = async (points: ReturnType<typeof fixture>, settings: Settings, variant: 'production' | 'explicit' | 'eligibility'):
  Promise<{ webgl: Snapshot; webgpu: Snapshot }> => ({
    webgl: await backends.webgl.render(points, settings, false, variant, false),
    webgpu: await backends.webgpu.render(points, settings, false, variant, false),
  })
  for (const packing of PACKING_NAMES) {
    for (const name of PACKING_FIXTURES) {
      for (const filter of ['nearest', 'linear'] as const) {
        for (const profile of PACKING_PROFILES) {
          if (cancelled()) return rows
          const points = fixture(name)
          const base: Settings = { ...DEFAULTS, ...profile.settings, imageFilter: filter, atlasPacking: packing, atlasIsolation: 'original' }
          const production = await render(points, base, 'production')
          const control = await compareSnapshotsAsync(production.webgl, production.webgpu, points, base)
          for (const policy of PACKING_POLICIES) {
            if (cancelled() && rows.length) return rows
            const settings = { ...base, atlasIsolation: policy }
            const pair = await render(points, settings, 'eligibility'); const explicit = await render(points, settings, 'explicit')
            const paired = await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, settings)
            const isolated = await inspectAtlasIsolation(pair, points, settings)
            const preservation = { webgl: compareColors(explicit.webgl, pair.webgl), webgpu: compareColors(explicit.webgpu, pair.webgpu) }
            const contribution = name === 'atlas-packing-overlap' ? await inspectForeground(backends, pair, points, settings, 'eligibility') : undefined
            const row: PackingRow = {
              packing,
              fixture: name,
              filter,
              profile: profile.name,
              policy,
              settings,
              paired,
              isolated,
              preservation,
              production: control,
              compatibility: await compareSnapshotsAsync(production.webgl, pair.webgpu, points, settings),
              contribution,
              passed: paired.valid && isolated.valid && contributionPasses(contribution) &&
                preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0,
            }
            rows.push(row); onRow(row)
            await new Promise<void>(resolve => { setTimeout(resolve, 0) })
          }
        }
      }
    }
  }
  return rows
}
export function renderPackingRows (host: HTMLElement, rows: PackingRow[]): void {
  host.innerHTML = `<p>${PACKING_ROW_COUNT} rows: 4 layouts × 2 fixtures × 2 filters × 3 profiles × 3 sampling policies. Five non-square images include
    a transparent image and a one-texel-wide faint image. Exact IDs/CPU masks, source visibility and the original 2/255 budget apply.
    Source-texel addressing fetches nearest samples by integer index and retains clamped linear filtering.
    Resampled layouts use the packed source pixels as the CPU reference. Production compatibility remains separate.</p>
    <table data-packing-summary><thead><tr><th>Layout / policy</th><th>Rows</th><th>Isolated image passed</th>
      <th>CPU mask differences · GL / GPU</th><th>CPU color failures · GL / GPU</th><th>Production compatible</th></tr></thead><tbody>
    ${PACKING_NAMES.flatMap(name => PACKING_POLICIES.map(policy => {
    const selected = rows.filter(r => r.packing === name && r.policy === policy); const layout = packingLayout(name)
    return `<tr><td>${name} · ${layout.width} × ${layout.height}<br>${policy}</td><td>${selected.length}</td>
      <td>${selected.filter(r => r.passed).length}</td>
      <td>${selected.reduce((n, r) => n + r.isolated.masks.webglReferenceFailures, 0)} /
        ${selected.reduce((n, r) => n + r.isolated.masks.webgpuReferenceFailures, 0)}</td>
      <td>${selected.reduce((n, r) => n + r.isolated.colors.webgl.budgetFailures, 0)} /
        ${selected.reduce((n, r) => n + r.isolated.colors.webgpu.budgetFailures, 0)}</td>
      <td>${selected.filter(r => r.compatibility.valid).length}</td></tr>`
  })).join('')}</tbody></table>
    <table data-packing-table><thead><tr><th>Layout / fixture</th><th>Filter / profile / policy</th><th>Isolated image</th>
      <th>CPU masks · GL / GPU</th><th>CPU colors beyond 2/255 · GL / GPU</th><th>Pick-only colors unchanged</th><th>Production compatible</th>
    </tr></thead><tbody>${rows.map(r => `<tr><td>${r.packing}<br>${r.fixture}</td><td>${r.filter}<br>${r.profile}<br>${r.policy}</td>
      <td>${r.passed ? 'Pass' : 'Fail'}</td><td>${r.isolated.masks.webglReferenceFailures} / ${r.isolated.masks.webgpuReferenceFailures}</td>
      <td>${r.isolated.colors.webgl.budgetFailures} / ${r.isolated.colors.webgpu.budgetFailures}</td>
      <td>${r.preservation.webgl.changedPixels === 0 && r.preservation.webgpu.changedPixels === 0 ? 'Pass' : 'Fail'}</td>
      <td>${r.compatibility.valid ? 'Pass' : 'Fail'}</td></tr>`).join('')}</tbody></table>`
}
