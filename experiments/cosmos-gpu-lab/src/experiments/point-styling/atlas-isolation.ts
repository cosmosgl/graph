import { pick, type Backend, type Snapshot } from './backend'
import { ATLAS_ISOLATION_POLICIES, sampleIsolatedImage, type AtlasIsolation } from './atlas'
import { ATLAS_FIXTURES, ATLAS_PROFILES } from './atlas-study'
import { DEFAULTS, fixture, type Settings } from './data'
import { atlasCpuColors, compareColors, compareSnapshotsAsync, type ColorComparison, type Comparison } from './reference'
import { contributionPasses, inspectForeground, type ContributionPair } from './tiny-alpha'

type Pair = { webgl: Snapshot; webgpu: Snapshot }
export type IsolationAudit = {
  masks: Comparison; colors: { webgl: ColorComparison; webgpu: ColorComparison }; valid: boolean;
}
export async function inspectAtlasIsolation (pair: Pair, points: ReturnType<typeof fixture>, settings: Settings): Promise<IsolationAudit> {
  // Name the alternate reference on copies: the captured renderer/policy and the
  // original comparison remain unchanged. This rule samples only the owning image.
  const isolated: Pair = { webgl: { ...pair.webgl, atlasIsolation: 'clamp' }, webgpu: { ...pair.webgpu, atlasIsolation: 'clamp' } }
  const masks = await compareSnapshotsAsync(isolated.webgl, isolated.webgpu, points, settings)
  const colors = { webgl: atlasCpuColors(isolated.webgl, points, settings), webgpu: atlasCpuColors(isolated.webgpu, points, settings) }
  return { masks, colors, valid: masks.valid && colors.webgl.budgetFailures === 0 && colors.webgpu.budgetFailures === 0 }
}
export type IsolationRow = {
  fixture: typeof ATLAS_FIXTURES[number]; profile: string; filter: 'nearest' | 'linear'; policy: AtlasIsolation; settings: Settings;
  paired: Comparison; isolated: IsolationAudit; contribution?: ContributionPair;
  preservation: { webgl: ColorComparison; webgpu: ColorComparison };
  originalColorChange: { webgl: ColorComparison; webgpu: ColorComparison }; productionCompatibility: Comparison; isolatedPass: boolean;
  edgeProbe?: { x: number; y: number; isolatedSample: number[]; webgl: { rgba: number[]; id: number | null };
    webgpu: { rgba: number[]; id: number | null }; };
}

export async function runIsolationSweep (
  backends: { webgl: Backend; webgpu: Backend }, onRow: (row: IsolationRow) => void, cancelled: () => boolean
): Promise<IsolationRow[]> {
  const rows: IsolationRow[] = []
  const render = async (points: ReturnType<typeof fixture>, settings: Settings, variant: 'eligibility' | 'explicit' | 'production'): Promise<Pair> => ({
    webgl: await backends.webgl.render(points, settings, false, variant, false),
    webgpu: await backends.webgpu.render(points, settings, false, variant, false),
  })
  for (const name of ATLAS_FIXTURES) {
    for (const filter of ['nearest', 'linear'] as const) {
      for (const profile of ATLAS_PROFILES) {
        if (cancelled()) return rows
        const base: Settings = { ...DEFAULTS, ...profile.settings, imageFilter: filter, atlasIsolation: 'original' }
        const points = fixture(name); const production = await render(points, base, 'production')
        const original = await render(points, base, 'eligibility')
        for (const policy of ATLAS_ISOLATION_POLICIES) {
          if (cancelled() && rows.length) return rows
          const settings = { ...base, atlasIsolation: policy }
          const pair = policy === 'original' ? original : await render(points, settings, 'eligibility')
          const explicit = await render(points, settings, 'explicit')
          const paired = await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, settings)
          const isolated = await inspectAtlasIsolation(pair, points, settings)
          const preservation = { webgl: compareColors(explicit.webgl, pair.webgl), webgpu: compareColors(explicit.webgpu, pair.webgpu) }
          const contribution = name === 'atlas-overlap' ? await inspectForeground(backends, pair, points, settings, 'eligibility') : undefined
          const row: IsolationRow = {
            fixture: name,
            profile: profile.name,
            filter,
            policy,
            settings,
            paired,
            isolated,
            preservation,
            contribution,
            originalColorChange: { webgl: compareColors(original.webgl, pair.webgl), webgpu: compareColors(original.webgpu, pair.webgpu) },
            productionCompatibility: await compareSnapshotsAsync(production.webgl, pair.webgpu, points, settings),
            isolatedPass: paired.valid && isolated.valid && contributionPasses(contribution) &&
              preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0,
          }
          if (name === 'atlas-edges' && profile.name === 'Native') {
            const read = (image: Snapshot): { rgba: number[]; id: number | null } => ({
              rgba: Array.from(image.color.subarray((112 * image.width + 208) * 4, (112 * image.width + 208) * 4 + 4)),
              id: pick(image, 208, 112),
            })
            row.edgeProbe = { x: 208, y: 112, isolatedSample: sampleIsolatedImage(0, 1, 0.5, filter), webgl: read(pair.webgl), webgpu: read(pair.webgpu) }
          }
          rows.push(row); onRow(row)
          await new Promise<void>(resolve => { setTimeout(resolve, 0) })
        }
      }
    }
  }
  return rows
}

export function renderIsolationRows (host: HTMLElement, rows: IsolationRow[]): void {
  host.innerHTML = `<p>160 rows: the same 40 atlas configurations × 4 UV policies. Isolated-image masks must match exactly;
    the original 2/255 color budget, source visibility and pick-only color preservation still apply.
    Original-policy and production compatibility verdicts stay separate. All rows remain visible.</p>
    <table data-isolation-summary><thead><tr><th>Policy</th><th>Rows</th><th>Paired rule passed</th><th>Isolated image passed</th>
      <th>CPU color failures · GL / GPU</th><th>Production compatible</th></tr></thead><tbody>
    ${ATLAS_ISOLATION_POLICIES.map(policy => {
    const selected = rows.filter(r => r.policy === policy)
    return `<tr><td>${policy}</td><td>${selected.length}</td><td>${selected.filter(r => r.paired.valid).length}</td>
      <td>${selected.filter(r => r.isolatedPass).length}</td><td>${selected.reduce((n, r) => n + r.isolated.colors.webgl.budgetFailures, 0)} /
      ${selected.reduce((n, r) => n + r.isolated.colors.webgpu.budgetFailures, 0)}</td>
      <td>${selected.filter(r => r.productionCompatibility.valid).length}</td></tr>`
  }).join('')}</tbody></table>
    <table data-isolation-table><thead><tr><th>Fixture / profile</th><th>Filter / policy</th><th>Isolated image</th>
      <th>CPU mask differences · GL / GPU</th><th>CPU color failures · GL / GPU</th><th>Pick-only colors unchanged</th>
      <th>Production compatible</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.fixture}<br>${r.profile}</td><td>${r.filter}<br>${r.policy}</td>
      <td>${r.isolatedPass ? 'Pass' : 'Fail'}</td><td>${r.isolated.masks.webglReferenceFailures} / ${r.isolated.masks.webgpuReferenceFailures}</td>
      <td>${r.isolated.colors.webgl.budgetFailures} / ${r.isolated.colors.webgpu.budgetFailures}</td>
      <td>${r.preservation.webgl.changedPixels === 0 && r.preservation.webgpu.changedPixels === 0 ? 'Pass' : 'Fail'}</td>
      <td>${r.productionCompatibility.valid ? 'Pass' : 'Fail'}</td></tr>`).join('')}</tbody></table>`
}
