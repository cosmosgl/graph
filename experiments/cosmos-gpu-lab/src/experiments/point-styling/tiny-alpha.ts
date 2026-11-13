import { pick, type Backend, type RenderVariant, type Snapshot } from './backend'
import { DEFAULTS, fixture, type Point, type Settings } from './data'
import { compareColors, compareSnapshotsAsync, type ColorComparison, type Comparison } from './reference'

export const TINY_OPACITIES = [0, 0.0001, 0.49 / 255, 0.5 / 255, 0.51 / 255, 1 / 255, 0.35, 1] as const
export type ContributionAudit = {
  checked: number; invisible: number; paintChangesWithoutForeground: number;
  first?: { x: number; y: number; point: number; sourceAlpha: number; composedAlpha: number };
}
type Pair = { webgl: Snapshot; webgpu: Snapshot }
export type ContributionPair = { webgl: ContributionAudit; webgpu: ContributionAudit }
export type TinyAlphaRow = {
  fixture: 'tiny-alpha' | 'tiny-overlap'; ratio: number; opacity: number;
  production: Comparison; candidate: Comparison; quantized: Comparison; eligibility: Comparison;
  productionContribution?: ContributionPair; candidateContribution?: ContributionPair; quantizedContribution?: ContributionPair;
  eligibilityContribution?: ContributionPair;
  colorPreservation: { webgl: ColorComparison; webgpu: ColorComparison };
  candidateAccepted: boolean; quantizedAccepted: boolean; eligibilityAccepted: boolean;
}

// Independent paint evidence, not a new CPU contour or an alpha threshold.
// A visible background cannot make an invisible foreground point contribute.
export function auditContribution (composed: Snapshot, isolated: Snapshot, point: number, background?: Snapshot): ContributionAudit {
  if (composed.width !== isolated.width || composed.height !== isolated.height) throw new Error('Contribution framebuffer dimensions differ')
  if (background && (composed.width !== background.width || composed.height !== background.height)) throw new Error('Background dimensions differ')
  const result: ContributionAudit = { checked: 0, invisible: 0, paintChangesWithoutForeground: 0 }
  for (let y = 0; y < composed.height; y++) {
    for (let x = 0; x < composed.width; x++) {
      const offset = (y * composed.width + x) * 4
      if (background) {
        let changed = false
        for (let c = 0; c < 4; c++) if (composed.color[offset + c] !== background.color[offset + c]) changed = true
        if (changed) result.paintChangesWithoutForeground++
      }
      if (pick(composed, x, y) !== point) continue
      result.checked++
      if (isolated.color[offset + 3] === 0) {
        result.invisible++
        result.first ??= { x, y, point, sourceAlpha: 0, composedAlpha: composed.color[offset + 3] }
      }
    }
  }
  return result
}

export async function inspectForeground (
  backends: { webgl: Backend; webgpu: Backend }, snapshots: Pair, points: Point[], settings: Settings, variant: RenderVariant
): Promise<ContributionPair> {
  const result = {} as ContributionPair
  for (const lane of ['webgl', 'webgpu'] as const) {
    const isolated = await backends[lane].render([points[1]], settings, false, variant, false)
    const background = await backends[lane].render([points[0]], settings, false, variant, false)
    result[lane] = auditContribution(snapshots[lane], isolated, 1, background)
  }
  return result
}

export function contributionPasses (audit?: ContributionPair): boolean {
  return !audit || (audit.webgl.invisible === 0 && audit.webgpu.invisible === 0)
}

export async function runTinyAlphaSweep (
  backends: { webgl: Backend; webgpu: Backend }, onRow: (row: TinyAlphaRow) => void, cancelled: () => boolean
): Promise<TinyAlphaRow[]> {
  const rows: TinyAlphaRow[] = []
  for (const name of ['tiny-alpha', 'tiny-overlap'] as const) {
    for (const ratio of [1, 2]) {
      for (const opacity of TINY_OPACITIES) {
        if (cancelled()) return rows
        const points = fixture(name); const settings = { ...DEFAULTS, ratio, opacity }
        const frames = {} as Record<RenderVariant, Pair>
        const contribution: Partial<Record<RenderVariant, ContributionPair>> = {}
        for (const variant of ['production', 'explicit', 'quantized', 'eligibility'] as const) {
          const pair = {} as Pair
          for (const lane of ['webgl', 'webgpu'] as const) pair[lane] = await backends[lane].render(points, settings, false, variant, false)
          frames[variant] = pair
          if (name === 'tiny-overlap') contribution[variant] = await inspectForeground(backends, pair, points, settings, variant)
        }
        const production = await compareSnapshotsAsync(frames.production.webgl, frames.production.webgpu, points, settings)
        const candidate = await compareSnapshotsAsync(frames.explicit.webgl, frames.explicit.webgpu, points, settings)
        const quantized = await compareSnapshotsAsync(frames.quantized.webgl, frames.quantized.webgpu, points, settings)
        const eligibility = await compareSnapshotsAsync(frames.eligibility.webgl, frames.eligibility.webgpu, points, settings)
        const colorPreservation = {
          webgl: compareColors(frames.explicit.webgl, frames.eligibility.webgl),
          webgpu: compareColors(frames.explicit.webgpu, frames.eligibility.webgpu),
        }
        const row: TinyAlphaRow = {
          fixture: name,
          ratio,
          opacity,
          production,
          candidate,
          quantized,
          eligibility,
          colorPreservation,
          productionContribution: contribution.production,
          candidateContribution: contribution.explicit,
          quantizedContribution: contribution.quantized,
          eligibilityContribution: contribution.eligibility,
          candidateAccepted: candidate.valid && contributionPasses(contribution.explicit),
          quantizedAccepted: quantized.valid && contributionPasses(contribution.quantized),
          eligibilityAccepted: eligibility.valid && contributionPasses(contribution.eligibility) &&
            colorPreservation.webgl.changedPixels === 0 && colorPreservation.webgpu.changedPixels === 0,
        }
        rows.push(row); onRow(row)
        await new Promise<void>(resolve => { setTimeout(resolve, 0) })
      }
    }
  }
  return rows
}

export function renderContributionAudit (host: HTMLElement, audit: ContributionPair): void {
  const section = document.createElement('section'); section.className = 'contribution-audit'
  section.innerHTML = `<h3>Picked-point contribution</h3><p>The faint foreground is also rendered by itself, through the same luma pipeline.
    This checks its own paint at selected pixels; background alpha does not establish foreground visibility.</p>
    <table data-contribution-audit><thead><tr><th>Backend</th><th>Foreground picks</th><th>Zero-alpha foreground picks</th>
      <th>Color pixels changed by removing foreground</th><th>First example</th></tr></thead>
    <tbody>${(['webgl', 'webgpu'] as const).map(lane => {
    const row = audit[lane]; const sample = row.first
    return `<tr><td>${lane}</td><td>${row.checked}</td><td>${row.invisible}</td><td>${row.paintChangesWithoutForeground}</td>
        <td>${sample ? `(${sample.x}, ${sample.y}) · point ${sample.point} · own alpha 0; composed alpha ${sample.composedAlpha}/255` : 'None'}</td></tr>`
  }).join('')}</tbody></table>`
  host.append(section)
}

export function renderTinyAlphaRows (host: HTMLElement, rows: TinyAlphaRow[]): void {
  host.innerHTML = `<p>Frozen sweep: 2 fixtures × 2 pixel ratios × 8 opacities. Each variant keeps its declared CPU rule; acceptance budgets are unchanged.
    Source-byte acceptance includes full-frame checks, own-source visibility and byte-identical color output to the explicit control.
    Invisible counts are GL / GPU; “own” checks the foreground in isolation where applicable.</p>
    <table data-tiny-alpha-table><thead><tr><th>Fixture</th><th>Ratio</th><th>Opacity</th><th>Retained controls</th>
      <th>Source-byte accepted</th><th>Source-byte invisible picks</th><th>Changed color pixels · GL / GPU</th></tr></thead>
    <tbody>${rows.map(row => `<tr><td>${row.fixture}</td><td>${row.ratio}</td><td>${row.opacity.toPrecision(5)}</td>
      <td>Production ${row.production.valid ? 'Pass' : 'Fail'}<br>Explicit ${row.candidateAccepted ? 'Pass' : 'Fail'}<br>
        Quantized ${row.quantizedAccepted ? 'Pass' : 'Fail'}</td>
      <td>${row.eligibilityAccepted ? 'Pass' : 'Fail'}</td>
      <td>${row.eligibility.webglInvisiblePicks} / ${row.eligibility.webgpuInvisiblePicks} frame
        ${row.eligibilityContribution ? `<br>${row.eligibilityContribution.webgl.invisible} / ${row.eligibilityContribution.webgpu.invisible} own` : ''}</td>
      <td>${row.colorPreservation.webgl.changedPixels} / ${row.colorPreservation.webgpu.changedPixels}</td></tr>`).join('')}</tbody></table>`
}
