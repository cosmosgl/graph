import type { Backend, Snapshot } from './backend'
import { DEFAULTS, type Settings } from './data'
import { dynamicPoints } from './dynamic-study'
import { DECODE_POLICIES, decodeImages, installDecoded, auditDecoded, type DecodeAudit, type DecodedImages, type DecodePolicy } from './image-decoding'
import { compareColors, compareSnapshotsAsync, type ColorComparison, type Comparison } from './reference'
import { inspectAtlasIsolation, type IsolationAudit } from './atlas-isolation'
import { inspectForeground, contributionPasses, type ContributionPair } from './tiny-alpha'

export const DECODING_PROFILES = [
  { name: 'Native', settings: {} },
  { name: 'Retina', settings: { ratio: 2 } },
  { name: 'Zoom out · translucent · reversed', settings: { zoom: 0.5, opacity: 0.35, reverse: true } },
  { name: 'Opacity zero', settings: { opacity: 0 } },
] satisfies Array<{ name: string; settings: Partial<Settings> }>
export const DECODING_ROW_COUNT = DECODE_POLICIES.length * DECODING_PROFILES.length * 2
export const decodingPoints = (): ReturnType<typeof dynamicPoints> => dynamicPoints().slice(0, 5)
export type DecodingRow = {
  policy: DecodePolicy; profile: string; filter: 'nearest' | 'linear'; settings: Settings; decoding: DecodeAudit[];
  paired: Comparison; isolated: IsolationAudit; contribution: ContributionPair;
  preservation: { webgl: ColorComparison; webgpu: ColorComparison };
  canonicalColors: { webgl: ColorComparison; webgpu: ColorComparison }; canonical: Comparison;
  production: Comparison; compatibility: Comparison; passed: boolean;
}
export async function runDecodingSweep (
  backends: { webgl: Backend; webgpu: Backend }, onRow: (row: DecodingRow) => void, cancelled: () => boolean,
  options: { profiles?: typeof DECODING_PROFILES; filters?: Array<'nearest' | 'linear'> } = {}
): Promise<DecodingRow[]> {
  const rows: DecodingRow[] = []; const points = decodingPoints(); const owned: DecodedImages[] = []
  const render = async (settings: Settings, variant: 'production' | 'explicit' | 'eligibility'):
  Promise<{ webgl: Snapshot; webgpu: Snapshot }> => ({
    webgl: await backends.webgl.render(points, settings, false, variant, false),
    webgpu: await backends.webgpu.render(points, settings, false, variant, false),
  })
  try {
    const reference = await decodeImages('production'); owned.push(reference)
    for (const policy of DECODE_POLICIES) {
      if (cancelled()) return rows
      const decoded = policy.id === 'production' ? reference : await decodeImages(policy.id)
      if (decoded !== reference) owned.push(decoded)
      const decoding = auditDecoded(decoded, reference)
      for (const profile of options.profiles ?? DECODING_PROFILES) {
        for (const filter of options.filters ?? ['nearest', 'linear'] as const) {
          if (cancelled()) return rows
          const settings: Settings = { ...DEFAULTS, ...profile.settings, imageFilter: filter, atlasIsolation: 'texel', atlasPacking: 'npot-square' }
          for (const backend of Object.values(backends)) installDecoded(backend, reference)
          const production = await render(settings, 'production'); const canonical = await render(settings, 'eligibility')
          for (const backend of Object.values(backends)) installDecoded(backend, decoded)
          const explicit = await render(settings, 'explicit'); const pair = await render(settings, 'eligibility')
          const paired = await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, settings)
          const isolated = await inspectAtlasIsolation(pair, points, settings)
          const contribution = await inspectForeground(backends, pair, points, settings, 'eligibility')
          const preservation = { webgl: compareColors(explicit.webgl, pair.webgl), webgpu: compareColors(explicit.webgpu, pair.webgpu) }
          const canonicalColors = { webgl: compareColors(canonical.webgl, pair.webgl), webgpu: compareColors(canonical.webgpu, pair.webgpu) }
          const sourceCompatibility = await compareSnapshotsAsync(canonical.webgl, pair.webgpu, points, settings)
          const row: DecodingRow = {
            policy: policy.id,
            profile: profile.name,
            filter,
            settings,
            decoding,
            paired,
            isolated,
            contribution,
            preservation,
            canonicalColors,
            canonical: sourceCompatibility,
            production: await compareSnapshotsAsync(production.webgl, production.webgpu, points, settings),
            compatibility: await compareSnapshotsAsync(production.webgl, pair.webgpu, points, settings),
            passed: decoding.every(audit => audit.valid) && paired.valid && isolated.valid && contributionPasses(contribution) &&
            preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0 && sourceCompatibility.valid &&
            canonicalColors.webgl.budgetFailures === 0 && canonicalColors.webgpu.budgetFailures === 0,
          }
          rows.push(row); onRow(row); await new Promise<void>(resolve => { setTimeout(resolve, 0) })
        }
      }
    }
  } finally {
    for (const backend of Object.values(backends)) backend.atlas.replace()
    owned.forEach(source => source.close())
  }
  return rows
}
export function renderDecodingRows (host: HTMLElement, rows: DecodingRow[]): void {
  host.innerHTML = `<p>${DECODING_ROW_COUNT} rows · ${DECODE_POLICIES.length} decode/upload paths × nearest/linear × four profiles.
    All paths use the same encoded PNGs.
    Production always uses image + canvas normalization; failed diagnostics remain visible. Source checks, exact masks/IDs, 2/255 colors
    and source visibility must all pass. ${rows.filter(row => row.passed).length} passed / ${rows.length} checked.</p>
    <table data-decoding-summary><thead><tr><th>Decode / upload</th><th>Checked / passed</th><th>Source passed</th><th>GPU frame passed</th>
      <th>Normalized input preserved</th><th>Production compatible</th></tr></thead><tbody>
      ${DECODE_POLICIES.map(policy => {
    const selected = rows.filter(r => r.policy === policy.id)
    return `<tr><td>${policy.name}</td><td>${selected.length} / ${selected.filter(r => r.passed).length}</td>
      <td>${selected.filter(r => r.decoding.every(a => a.valid)).length}</td><td>${selected.filter(r => r.paired.valid && r.isolated.valid).length}</td>
      <td>${selected.filter(r => r.canonical.valid && r.canonicalColors.webgl.budgetFailures === 0 &&
        r.canonicalColors.webgpu.budgetFailures === 0).length}</td>
      <td>${selected.filter(r => r.compatibility.valid).length}</td></tr>`
  }).join('')}</tbody></table>
    <table data-decoding-table><thead><tr><th>Path / profile / filter</th><th>Accepted</th><th>CPU masks · GL / GPU</th>
      <th>CPU color failures · GL / GPU</th><th>Normalized color failures · GL / GPU</th><th>Production compatible</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.policy}<br>${r.profile} · ${r.filter}</td><td>${r.passed ? 'Pass' : 'Fail'}</td>
        <td>${r.isolated.masks.webglReferenceFailures} / ${r.isolated.masks.webgpuReferenceFailures}</td>
        <td>${r.isolated.colors.webgl.budgetFailures} / ${r.isolated.colors.webgpu.budgetFailures}</td>
        <td>${r.canonicalColors.webgl.budgetFailures} / ${r.canonicalColors.webgpu.budgetFailures}</td>
        <td>${r.compatibility.valid ? 'Pass' : 'Fail'}</td></tr>`).join('')}</tbody></table>`
}
