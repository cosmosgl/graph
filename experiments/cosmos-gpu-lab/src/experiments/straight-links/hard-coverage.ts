import type { Backend, Snapshot } from './backend'
import { DEFAULTS, fixture, type Fixture, type HardCoverage, type Settings } from './data'
import { compare, compareColors, type Comparison, type ColorResult } from './reference'
export const HARD_METHODS: HardCoverage[] = ['native', 'linear', 'pixel']
export const HARD_CASES: Array<{ name: string; fixture: Fixture; link: number; pixel: [number, number]; settings: Settings }> = [
  { name: 'Native width 3', fixture: 'ribbons', link: 1, pixel: [100, 96], settings: { ...DEFAULTS, blend: false } },
  {
    name: 'Zoom 0.5 · default color',
    fixture: 'limits',
    link: 6,
    pixel: [280, 135],
    settings: { ...DEFAULTS, blend: false, zoom: 0.5, opacity: 0.35, reverse: true },
  },
  {
    name: 'Clipped minimum width · zoom 2',
    fixture: 'limits',
    link: 1,
    pixel: [100, 11],
    settings: { ...DEFAULTS, blend: false, zoom: 2, scaleOnZoom: false },
  },
]
export type EdgeSample = { rgba: number[]; varying: number[]; pixel: number[]; predicted: boolean; observed: boolean; consistent: boolean }
export type HardRow = { name: string; fixture: Fixture; link: number; at: [number, number]; settings: Settings; method: HardCoverage;
  comparison: Comparison; preservation: { webgl: ColorResult; webgpu: ColorResult };
  samples: { webgl: EdgeSample; webgpu: EdgeSample }; passed: boolean; }
function sample (image: Snapshot, at: [number, number], method: HardCoverage): EdgeSample {
  if (!image.probe) throw new Error('Float coverage probes are required')
  const i = (at[1] * image.width + at[0]) * 4
  const varying = Array.from(image.probe.varying.subarray(i, i + 4)); const pixel = Array.from(image.probe.pixel.subarray(i, i + 4))
  const rgba = Array.from(image.color.subarray(i, i + 4)); const coverage = method === 'pixel' ? pixel[2] : varying[2]
  const observed = rgba[3] > 0; const predicted = varying[3] !== 0 && coverage >= 0.5
  return { rgba, varying, pixel, predicted, observed, consistent: predicted === observed }
}
export async function replayHardCoverage (backends: { webgl: Backend; webgpu: Backend }, onRow: (row: HardRow) => void,
  cancelled: () => boolean): Promise<HardRow[]> {
  const rows: HardRow[] = []
  for (const c of HARD_CASES) {
    if (cancelled()) return rows
    const input = fixture(c.fixture)
    // Preserve original indices, but isolate the source so probe overdraw cannot
    // be confused with the color/ID of a surviving earlier link.
    const scene = { ...input, links: input.links.map((l, id) => id === c.link ? l : { ...l, width: 0 }) }
    const production = {
      webgl: await backends.webgl.render(scene, c.settings, 'production', false),
      webgpu: await backends.webgpu.render(scene, c.settings, 'production', false),
    }
    const gl = await backends.webgl.render(scene, c.settings, 'visible', false, true)
    for (const method of HARD_METHODS) {
      if (cancelled()) return rows
      const settings = { ...c.settings, hardCoverage: method }
      const gpu = await backends.webgpu.render(scene, settings, 'visible', false, true)
      const comparison = await compare(gl, gpu, scene, c.settings)
      const preservation = { webgl: compareColors(production.webgl.color, gl.color), webgpu: compareColors(production.webgpu.color, gpu.color) }
      const row: HardRow = {
        name: c.name,
        fixture: c.fixture,
        link: c.link,
        at: c.pixel,
        settings,
        method,
        comparison,
        preservation,
        samples: { webgl: sample(gl, c.pixel, 'native'), webgpu: sample(gpu, c.pixel, method) },
        passed: comparison.passed && preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0,
      }
      rows.push(row); onRow(row); await new Promise<void>(resolve => { setTimeout(resolve, 0) })
    }
  }
  return rows
}
export function renderHardCoverage (host: HTMLElement, rows: HardRow[]): void {
  const number = (value: number): string => value === 0 ? '0' : String(value)
  host.innerHTML = `<p>${rows.length} / ${HARD_CASES.length * HARD_METHODS.length} isolated comparisons.
    Full-frame gates remain exact. Float probes explain the chosen pixel; they never supply expected IDs.
    Alternative WebGPU methods can change original color bytes and remain rejected by that gate even if GPU/CPU agreement improves.</p>
    <table data-hard-results><thead><tr><th>Source / WebGPU method</th><th>Result · all gates</th><th>IDs</th><th>CPU masks · GL / GPU</th>
      <th>Color failures · GPU pair / CPU GL / CPU GPU</th><th>Changed original color · GL / GPU</th><th>Invisible picks · GL / GPU</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.name}<br>${r.method}</td><td>${r.passed ? 'Pass' : 'Fail'}</td><td>${r.comparison.idDifferences}</td>
      <td>${r.comparison.masks.webgl} / ${r.comparison.masks.webgpu}</td>
      <td>${r.comparison.colors.budgetFailures} / ${r.comparison.cpuColors.webgl.budgetFailures} / ${r.comparison.cpuColors.webgpu.budgetFailures}</td>
      <td>${r.preservation.webgl.changedPixels} / ${r.preservation.webgpu.changedPixels}</td>
      <td>${r.comparison.invisible.webgl} / ${r.comparison.invisible.webgpu}</td></tr>`).join('')}</tbody></table>
    <table data-hard-probes><thead><tr><th>Pixel / source / method</th><th>Backend</th><th>Interpolated y</th><th>Smoothing</th>
      <th>Varying coverage</th><th>Distance / half-width</th><th>Pixel coverage</th><th>Rendered alpha byte</th>
      <th>Probe / color consistent</th></tr></thead><tbody>
    ${rows.flatMap(r => (['webgl', 'webgpu'] as const).map(lane => {
    const s = r.samples[lane]
    return `<tr><td>(${r.at.join(', ')}) · link ${r.link}<br>${r.method}</td><td>${lane}</td>
      <td>${number(s.varying[0])}</td><td>${number(s.varying[1])}</td><td>${number(s.varying[2])}</td>
      <td>${number(s.pixel[0])} / ${number(s.pixel[1])}</td>
      <td>${number(s.pixel[2])}</td><td>${s.rgba[3]}</td>
      <td>${s.consistent ? 'Yes' : 'No · probe differs'}</td></tr>`
  })).join('')}</tbody></table>`
}
