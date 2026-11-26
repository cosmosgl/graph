import type { RenderVariant } from './backend'
import type { Comparison } from './reference'

export function renderExplicitControl (
  host: HTMLElement, comparisons: { production: Comparison; compatibility: Comparison }, variant: RenderVariant
): void {
  const section = document.createElement('section'); section.className = 'explicit-control'
  const { production, compatibility } = comparisons
  const label = variant === 'eligibility' ? 'source-byte' : variant === 'quantized' ? 'quantized' : 'explicit'
  const row = (label: string, result: Comparison): string => `<tr><td>${label}<br>
    CPU: ${result.pickingRules.webgl} / ${result.pickingRules.webgpu}</td><td>${result.valid ? 'Pass' : 'Fail'}</td>
    <td>${result.idDisagreements}</td><td>${result.webglReferenceFailures} / ${result.webgpuReferenceFailures}</td>
    <td>${result.colorFailures} · ${result.maxChannelError}/255</td><td>${result.webglInvisiblePicks} / ${result.webgpuInvisiblePicks}</td></tr>`
  section.innerHTML = `<h3>Production control and compatibility</h3>
    <p>The ${label} candidate uses padded quads and closed shape bounds.
      The production shader and its legacy CPU rule are retained below. ${variant === 'eligibility'
    ? 'The source-alpha CPU rule gates picking with a nonzero source byte; color retains the original alpha and blend state.'
    : variant === 'quantized'
      ? 'The source-alpha CPU rule intersects geometry with nonzero quantized source alpha; color and picking use the same quantized value.'
      : 'The candidate CPU rule additionally rejects global opacity zero.'}
      Geometric contours, exact-ID checks and the 2/255 color budget stay unchanged.</p>
    <table data-production-comparison><thead><tr><th>Full-frame comparison</th><th>Result</th><th>ID differences</th>
      <th>CPU mask differences · left / right</th><th>Color failures · max</th><th>Invisible picks · left / right</th></tr></thead><tbody>
      ${row('Production WebGL ↔ compatibility WebGPU', production)}
      ${row(`Production WebGL ↔ ${label} WebGPU`, compatibility)}</tbody></table>
    <p>A passing candidate geometry check does not turn a failed production-compatibility check into a pass.</p>`
  host.append(section)
}
