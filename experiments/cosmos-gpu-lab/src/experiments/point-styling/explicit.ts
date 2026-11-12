import { pick, type Snapshot } from './backend'
import type { Point, Settings } from './data'
import { compareSnapshots, referencePick } from './reference'

// Frozen rejected pixels from the ratio-2 isolation, not an acceptance filter.
// The full framebuffer still passes through compareSnapshots without exclusions.
export const BOUNDARY_PIXELS = [[630, 120], [631, 121], [130, 319], [132, 321], [630, 318], [633, 321]] as const

export function renderExplicitControl (
  host: HTMLElement, original: { webgl: Snapshot; webgpu: Snapshot }, selected: { webgl: Snapshot; webgpu: Snapshot }, points: Point[], settings: Settings,
  comparisons: { production: ReturnType<typeof compareSnapshots>; compatibility: ReturnType<typeof compareSnapshots> }
): void {
  const section = document.createElement('section'); section.className = 'explicit-control'
  const { production, compatibility } = comparisons
  const row = (label: string, result: ReturnType<typeof compareSnapshots>): string => `<tr><td>${label}<br>
    CPU: ${result.pickingRules.webgl} / ${result.pickingRules.webgpu}</td><td>${result.valid ? 'Pass' : 'Fail'}</td>
    <td>${result.idDisagreements}</td><td>${result.webglReferenceFailures} / ${result.webgpuReferenceFailures}</td>
    <td>${result.colorFailures} · ${result.maxChannelError}/255</td><td>${result.webglInvisiblePicks} / ${result.webgpuInvisiblePicks}</td></tr>`
  section.innerHTML = `<h3>Production control and compatibility</h3>
    <p>The canvases and audit above show the explicit-coordinate candidate in both APIs. It uses padded quads and closed shape bounds.
      The production shader and its legacy CPU rule are retained below. The candidate CPU rule additionally rejects global opacity zero.
      Geometric contours, exact-ID checks and the 2/255 color budget stay unchanged.</p>
    <table data-production-comparison><thead><tr><th>Full-frame comparison</th><th>Result</th><th>ID differences</th>
      <th>CPU mask differences · left / right</th><th>Color failures · max</th><th>Invisible picks · left / right</th></tr></thead><tbody>
      ${row('Production WebGL ↔ compatibility WebGPU', production)}
      ${row('Production WebGL ↔ explicit WebGPU', compatibility)}</tbody></table>
    <p>A passing candidate geometry check does not turn a failed production-compatibility check into a pass.</p>`
  if (settings.ratio === 2 && settings.zoom === 1 && points.length === 12 && points[9].size === 13.3) {
    const id = (snapshot: Snapshot, x: number, y: number): string => String(pick(snapshot, x, y) ?? 'background')
    section.insertAdjacentHTML('beforeend', `<h4>Six boundary pixels</h4>
      <p>Replay of the original top/right omissions. Every framebuffer pixel is still checked above.</p>
      <table data-boundary-replay><thead><tr><th>Pixel</th><th>Production GL / GPU IDs</th>
      <th>Explicit GL / GPU IDs</th><th>CPU ID</th><th>Explicit GL / GPU alpha</th></tr></thead><tbody>
      ${BOUNDARY_PIXELS.map(([x, y]) => `<tr><td>(${x}, ${y})</td>
        <td>${id(original.webgl, x, y)} / ${id(original.webgpu, x, y)}</td>
        <td>${id(selected.webgl, x, y)} / ${id(selected.webgpu, x, y)}</td>
        <td>${String(referencePick(points, settings, x + 0.5, y + 0.5) ?? 'background')}</td>
        <td>${selected.webgl.color[(y * selected.webgl.width + x) * 4 + 3]} / ${selected.webgpu.color[(y * selected.webgpu.width + x) * 4 + 3]}</td>
        </tr>`).join('')}</tbody></table>`)
  }
  host.append(section)
}
