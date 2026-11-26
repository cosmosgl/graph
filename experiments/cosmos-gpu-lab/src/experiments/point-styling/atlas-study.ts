import { pick, type Backend, type RenderVariant, type Snapshot } from './backend'
import { sampleAtlas } from './atlas'
import { DEFAULTS, fixture, type Settings } from './data'
import { atlasCpuColors, compareColors, compareSnapshotsAsync, type ColorComparison, type Comparison } from './reference'
import { contributionPasses, inspectForeground, type ContributionPair } from './tiny-alpha'

export const ATLAS_FIXTURES = ['atlas-images', 'atlas-shapes', 'atlas-overlap', 'atlas-edges'] as const
export const ATLAS_PROFILES = [
  { name: 'Native', settings: {} },
  { name: 'Retina', settings: { ratio: 2 } },
  { name: 'Zoom out · translucent', settings: { zoom: 0.5, opacity: 0.35 } },
  { name: 'Zoom in · reversed', settings: { zoom: 2, reverse: true } },
  { name: 'Hidden', settings: { opacity: 0 } },
] satisfies Array<{ name: string; settings: Partial<Settings> }>
export type AtlasRow = {
  fixture: typeof ATLAS_FIXTURES[number]; profile: string; filter: 'nearest' | 'linear'; settings: Settings;
  production: Comparison; explicit: Comparison; candidate: Comparison; compatibility: Comparison;
  contribution?: Partial<Record<RenderVariant, ContributionPair>>;
  cpuColors: { webgl: ColorComparison; webgpu: ColorComparison };
  colorPreservation: { webgl: ColorComparison; webgpu: ColorComparison }; accepted: boolean;
  edgeProbe?: { x: number; y: number; cpuSample: number[];
    webgl: { rgba: number[]; id: number | null }; webgpu: { rgba: number[]; id: number | null }; };
}
export async function runAtlasSweep (
  backends: { webgl: Backend; webgpu: Backend }, onRow: (row: AtlasRow) => void, cancelled: () => boolean
): Promise<AtlasRow[]> {
  const rows: AtlasRow[] = []
  for (const name of ATLAS_FIXTURES) {
    for (const filter of ['nearest', 'linear'] as const) {
      for (const profile of ATLAS_PROFILES) {
        if (cancelled()) return rows
        const settings = { ...DEFAULTS, ...profile.settings, imageFilter: filter }; const points = fixture(name)
        const frames = {} as Record<'production' | 'explicit' | 'eligibility', { webgl: Snapshot; webgpu: Snapshot }>
        const contribution: AtlasRow['contribution'] = {}
        for (const variant of ['production', 'explicit', 'eligibility'] as const) {
          frames[variant] = {
            webgl: await backends.webgl.render(points, settings, false, variant, false),
            webgpu: await backends.webgpu.render(points, settings, false, variant, false),
          }
          if (name === 'atlas-overlap') contribution[variant] = await inspectForeground(backends, frames[variant], points, settings, variant)
        }
        const production = await compareSnapshotsAsync(frames.production.webgl, frames.production.webgpu, points, settings)
        const explicit = await compareSnapshotsAsync(frames.explicit.webgl, frames.explicit.webgpu, points, settings)
        const candidate = await compareSnapshotsAsync(frames.eligibility.webgl, frames.eligibility.webgpu, points, settings)
        const compatibility = await compareSnapshotsAsync(frames.production.webgl, frames.eligibility.webgpu, points, settings)
        const cpuColors = {
          webgl: atlasCpuColors(frames.eligibility.webgl, points, settings),
          webgpu: atlasCpuColors(frames.eligibility.webgpu, points, settings),
        }
        const colorPreservation = {
          webgl: compareColors(frames.explicit.webgl, frames.eligibility.webgl),
          webgpu: compareColors(frames.explicit.webgpu, frames.eligibility.webgpu),
        }
        const row: AtlasRow = {
          fixture: name,
          profile: profile.name,
          filter,
          settings,
          production,
          explicit,
          candidate,
          compatibility,
          contribution,
          cpuColors,
          colorPreservation,
          accepted: candidate.valid && contributionPasses(contribution.eligibility) && cpuColors.webgl.budgetFailures === 0 &&
            cpuColors.webgpu.budgetFailures === 0 && colorPreservation.webgl.changedPixels === 0 && colorPreservation.webgpu.changedPixels === 0,
        }
        if (name === 'atlas-edges' && profile.name === 'Native') {
          const sample = (image: Snapshot): { rgba: number[]; id: number | null } => ({
            rgba: Array.from(image.color.subarray((112 * image.width + 208) * 4, (112 * image.width + 208) * 4 + 4)),
            id: pick(image, 208, 112),
          })
          row.edgeProbe = {
            x: 208,
            y: 112,
            cpuSample: sampleAtlas(0, 1, 0.5, filter),
            webgl: sample(frames.eligibility.webgl),
            webgpu: sample(frames.eligibility.webgpu),
          }
        }
        rows.push(row); onRow(row)
        await new Promise<void>(resolve => { setTimeout(resolve, 0) })
      }
    }
  }
  return rows
}

export function renderAtlasRows (host: HTMLElement, rows: AtlasRow[]): void {
  host.innerHTML = `<p>40 full-frame cases: 4 fixtures × 2 filters × 5 frozen profiles. No pixels or failed rows are excluded.
    Candidate acceptance includes exact IDs/CPU masks, the original 2/255 color budget, CPU texture colors,
    own-source visibility and unchanged color output. Production compatibility stays separate.
    Edge-fixture parity does not establish tile isolation: production UV rectangles may sample a neighboring tile.</p>
    <table data-atlas-table><thead><tr><th>Fixture / profile</th><th>Filter</th><th>Production / explicit</th><th>Source-byte candidate</th>
    <th>CPU color failures · GL / GPU</th><th>Changed colors · GL / GPU</th><th>Production compatibility</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.fixture}<br>${r.profile}</td><td>${r.filter}</td>
      <td>${r.production.valid ? 'Pass' : 'Fail'} / ${r.explicit.valid ? 'Pass' : 'Fail'}</td><td>${r.accepted ? 'Pass' : 'Fail'}</td>
      <td>${r.cpuColors.webgl.budgetFailures} / ${r.cpuColors.webgpu.budgetFailures}</td>
      <td>${r.colorPreservation.webgl.changedPixels} / ${r.colorPreservation.webgpu.changedPixels}</td>
      <td>${r.compatibility.valid ? 'Pass' : 'Fail'}</td></tr>`).join('')}</tbody></table>`
}
