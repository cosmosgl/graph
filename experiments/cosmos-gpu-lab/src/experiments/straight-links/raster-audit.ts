import { pick } from '../../gpu/rgba-readback'
import type { Backend, Snapshot } from './backend'
import { DEFAULTS, fixture, type Fixture, type Settings, type Scene } from './data'
import { compare, compareColors, cpuColors, ribbons, scalarPick, type Comparison, type ColorResult } from './reference'
import { capturedQuad, exactCaps, exactQuad, type Vec } from './raster-math'
export const RASTER_CASES: Array<{
  name: string; fixture: Fixture; link: number; at: [number, number]; axis: 'x' | 'y'; settings: Settings; firstFailure?: boolean;
}> = [
  { name: 'Vertical half-pixel caps', fixture: 'boundaries', link: 2, at: [280, 40], axis: 'y', settings: DEFAULTS },
  {
    name: 'Vertical caps · zoom 0.5',
    fixture: 'overlap',
    link: 1,
    at: [253, 102],
    axis: 'y',
    settings: { ...DEFAULTS, zoom: 0.5, opacity: 0.35, reverse: true },
  },
  { name: '3:1 end cap · ratio 2', fixture: 'boundaries', link: 7, at: [927, 382], axis: 'x', settings: { ...DEFAULTS, ratio: 2 } },
  { name: '45° start cap', fixture: 'boundaries', link: 6, at: [326, 62], axis: 'x', settings: DEFAULTS },
  { name: 'Horizontal cap control', fixture: 'boundaries', link: 0, at: [40, 40], axis: 'x', settings: DEFAULTS },
  { name: 'Width 2.5 control', fixture: 'boundaries', link: 1, at: [40, 94], axis: 'x', settings: DEFAULTS },
  { name: 'Fractional oblique control', fixture: 'boundaries', link: 3, at: [330, 60], axis: 'x', settings: DEFAULTS },
  {
    name: 'Clipped hard oblique',
    fixture: 'ribbons',
    link: 5,
    at: [400, 0],
    axis: 'x',
    firstFailure: true,
    settings: { ...DEFAULTS, zoom: 2, scaleOnZoom: false, blend: false },
  },
]
export const RASTER_VARIANTS = [
  { name: '−1/8 px', shift: -1 / 8 }, { name: '−1/1024 px', shift: -1 / 1024 }, { name: 'Original', shift: 0 },
  { name: '+1/1024 px', shift: 1 / 1024 }, { name: '+1/8 px', shift: 1 / 8 }, { name: 'Endpoints reversed', shift: 0, reversed: true },
]
export const RASTER_ROWS = RASTER_CASES.length * RASTER_VARIANTS.length
export type RasterSample = { x: number; y: number; cpu: number | null; webgl: number | null; webgpu: number | null;
  cpuColor: number[]; colors: { webgl: number[]; webgpu: number[] }; carrier: { webgl: boolean; webgpu: boolean };
  coverage: { cpu: number; webgl: number; webgpu: number }; caps: ReturnType<typeof exactCaps>;
  exactTriangles: { cpu: boolean; webgl: boolean; webgpu: boolean }; }
export type RasterRow = { name: string; fixture: Fixture; link: number; variant: string; shift: number; reversed: boolean; settings: Settings;
  scene: Scene; comparison: Comparison; preservation: { webgl: ColorResult; webgpu: ColorResult };
  carrierReplay: { sameCapturedVertices: boolean; fixedVertexDifferences: number; webglNativeDifferences: number; webgpuNativeDifferences: number;
    anchor: { webgl: boolean; webgpu: boolean }; };
  geometry: { cpu: Vec[]; webgl: ReturnType<typeof capturedQuad>; webgpu: ReturnType<typeof capturedQuad> };
  anchor: RasterSample; failures: RasterSample[]; passed: boolean;
  reversal?: { cpuIds: number; webglIds: number; webgpuIds: number; webglColors: ColorResult; webgpuColors: ColorResult }; }
function inspect (a: Snapshot, b: Snapshot, scene: Scene, settings: Settings, link: number, at: [number, number]):
Pick<RasterRow, 'geometry' | 'anchor' | 'failures'> {
  if (!a.probe || !b.probe) throw new Error('Carrier and vertex captures are required')
  const ribbon = ribbons(scene, settings, true, 'visible')[0]
  const expected = scalarPick([ribbon], settings, 'visible'); const colors = cpuColors(scene, settings)
  const geometry = {
    cpu: ribbon.vertices,
    webgl: capturedQuad(a.probe.vertices, link, a.width, a.height),
    webgpu: capturedQuad(b.probe.vertices, link, b.width, b.height),
  }
  const sample = (x: number, y: number): RasterSample => {
    const i = (y * a.width + x) * 4; const point: Vec = [x + 0.5, y + 0.5]
    const distance = Math.abs((point[0] - ribbon.a[0]) * ribbon.normal[0] + (point[1] - ribbon.a[1]) * ribbon.normal[1])
    const t = Math.max(0, Math.min(1, (ribbon.core + 1) * 0.5 - distance))
    return {
      x,
      y,
      cpu: expected(...point),
      webgl: pick(a, x, y),
      webgpu: pick(b, x, y),
      cpuColor: Array.from(colors.subarray(i, i + 4)),
      colors: { webgl: Array.from(a.color.subarray(i, i + 4)), webgpu: Array.from(b.color.subarray(i, i + 4)) },
      carrier: { webgl: a.probe!.varying[i + 3] > 0, webgpu: b.probe!.varying[i + 3] > 0 },
      coverage: { cpu: t * t * (3 - 2 * t), webgl: a.probe!.varying[i + 2], webgpu: b.probe!.varying[i + 2] },
      caps: exactCaps(ribbon.a, ribbon.b, point),
      exactTriangles: {
        cpu: exactQuad(ribbon.vertices, point),
        webgl: exactQuad(geometry.webgl.screen, point),
        webgpu: exactQuad(geometry.webgpu.screen, point),
      },
    }
  }
  const failures: RasterSample[] = []
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4; const gl = pick(a, x, y); const gpu = pick(b, x, y); const cpu = expected(x + 0.5, y + 0.5)
      const colorError = [0, 1, 2, 3].some(c => Math.max(Math.abs(a.color[i + c] - b.color[i + c]),
        Math.abs(a.color[i + c] - colors[i + c]), Math.abs(b.color[i + c] - colors[i + c])) > 2)
      if (gl !== gpu || gl !== cpu || gpu !== cpu || colorError) failures.push(sample(x, y))
    }
  }
  return { geometry, failures, anchor: sample(...at) }
}
export async function replayRaster (backends: { webgl: Backend; webgpu: Backend }, onRow: (row: RasterRow) => void,
  cancelled: () => boolean): Promise<RasterRow[]> {
  const rows: RasterRow[] = []
  for (const c of RASTER_CASES) {
    let original: { scene: Scene; webgl: Snapshot; webgpu: Snapshot } | undefined
    for (const v of RASTER_VARIANTS) {
      if (cancelled()) return rows
      const input = fixture(c.fixture); const selected = input.links[c.link]; const worldShift = v.shift / (c.settings.zoom * c.settings.ratio)
      const scene = {
        points: input.points.map((p, i) => i === selected.source || i === selected.target ? { ...p, [c.axis]: p[c.axis] + worldShift } : p),
        links: input.links.map((l, i) => i === c.link ? v.reversed ? { ...l, source: l.target, target: l.source } : l : { ...l, width: 0 }),
      }
      const production = {
        webgl: await backends.webgl.render(scene, c.settings, 'production', false),
        webgpu: await backends.webgpu.render(scene, c.settings, 'production', false),
      }
      const a = await backends.webgl.render(scene, c.settings, 'visible', false, true)
      const b = await backends.webgpu.render(scene, c.settings, 'visible', false, true)
      const comparison = await compare(a, b, scene, c.settings)
      const preservation = { webgl: compareColors(production.webgl.color, a.color), webgpu: compareColors(production.webgpu.color, b.color) }
      const audit = inspect(a, b, scene, c.settings, c.link, c.at)
      if (c.firstFailure && audit.failures.length) audit.anchor = audit.failures[0]
      const clips = audit.geometry.webgl.clip.flat(); const sameCapturedVertices = clips.every((n, i) => n === audit.geometry.webgpu.clip.flat()[i])
      // The same four f32 positions feed both APIs. No endpoint, extrusion,
      // normalization or projection math remains in these carrier programs.
      const fixedGL = await backends.webgl.rasterize(clips, a.width, a.height)
      const fixedGPU = await backends.webgpu.rasterize(clips, b.width, b.height)
      const ownGPU = sameCapturedVertices ? fixedGPU : await backends.webgpu.rasterize(audit.geometry.webgpu.clip.flat(), b.width, b.height)
      const carrierReplay = {
        sameCapturedVertices,
        fixedVertexDifferences: 0,
        webglNativeDifferences: 0,
        webgpuNativeDifferences: 0,
        anchor: { webgl: false, webgpu: false },
      }
      for (let i = 0; i < fixedGL.length; i += 4) {
        if (fixedGL[i + 3] !== fixedGPU[i + 3]) carrierReplay.fixedVertexDifferences++
        if ((fixedGL[i + 3] > 0) !== (a.probe!.varying[i + 3] > 0)) carrierReplay.webglNativeDifferences++
        if ((ownGPU[i + 3] > 0) !== (b.probe!.varying[i + 3] > 0)) carrierReplay.webgpuNativeDifferences++
      }
      const anchorIndex = (audit.anchor.y * a.width + audit.anchor.x) * 4 + 3
      carrierReplay.anchor = { webgl: fixedGL[anchorIndex] > 0, webgpu: fixedGPU[anchorIndex] > 0 }
      const row: RasterRow = {
        name: c.name,
        fixture: c.fixture,
        link: c.link,
        variant: v.name,
        shift: v.shift,
        reversed: !!v.reversed,
        settings: c.settings,
        scene,
        comparison,
        preservation,
        ...audit,
        carrierReplay,
        passed: comparison.passed && preservation.webgl.changedPixels === 0 && preservation.webgpu.changedPixels === 0,
      }
      if (v.name === 'Original') original = { scene, webgl: a, webgpu: b }
      if (v.reversed && original) {
        const before = scalarPick(ribbons(original.scene, c.settings, true, 'visible'), c.settings, 'visible')
        const after = scalarPick(ribbons(scene, c.settings, true, 'visible'), c.settings, 'visible')
        const reversal = {
          cpuIds: 0,
          webglIds: 0,
          webgpuIds: 0,
          webglColors: compareColors(original.webgl.color, a.color),
          webgpuColors: compareColors(original.webgpu.color, b.color),
        }
        for (let y = 0; y < a.height; y++) {
          for (let x = 0; x < a.width; x++) {
            if (before(x + 0.5, y + 0.5) !== after(x + 0.5, y + 0.5)) reversal.cpuIds++
            if (pick(original.webgl, x, y) !== pick(a, x, y)) reversal.webglIds++
            if (pick(original.webgpu, x, y) !== pick(b, x, y)) reversal.webgpuIds++
          }
        }
        row.reversal = reversal
      }
      rows.push(row); onRow(row); await new Promise<void>(resolve => { setTimeout(resolve, 0) })
    }
  }
  return rows
}
export function renderRaster (host: HTMLElement, rows: RasterRow[]): void {
  host.innerHTML = `<p>${rows.length} / ${RASTER_ROWS} compared · ${rows.filter(r => r.passed).length} pass all retained gates.
    Shifts are device pixels along the stated axis; moving inputs is a sensitivity test, not a fix of the original fixture.
    All failed pixels and captured vertices export locally. Exact signs explain stored binary coordinates; they never override acceptance.</p>
    <table data-raster-results><thead><tr><th>Source / input variant</th><th>Result</th><th>ID differences</th><th>CPU masks · GL / GPU</th>
      <th>Color failures · pair / CPU GL / CPU GPU</th><th>Changed original color · GL / GPU</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.name}<br>${r.variant}</td><td>${r.passed ? 'Pass' : 'Fail'}</td><td>${r.comparison.idDifferences}</td>
      <td>${r.comparison.masks.webgl} / ${r.comparison.masks.webgpu}</td>
      <td>${r.comparison.colors.budgetFailures} / ${r.comparison.cpuColors.webgl.budgetFailures} / ${r.comparison.cpuColors.webgpu.budgetFailures}</td>
      <td>${r.preservation.webgl.changedPixels} / ${r.preservation.webgpu.changedPixels}</td></tr>`).join('')}</tbody></table>
    <h3>Original raster samples</h3><p>Carrier presence comes from separate float programs before fragment discard.
      Captured triangles use a common exact top-left diagnostic; hardware viewport conversion and edge ownership can differ.
      Cap signs: positive is inside the longitudinal plane, zero is an exact tie, negative is outside.</p>
    <table data-raster-samples><thead><tr><th>Source / pixel</th><th>IDs · CPU / GL / GPU</th><th>Carrier · GL / GPU</th><th>Coverage · CPU / GL / GPU</th>
      <th>Exact cap sign · start / end</th><th>Exact triangles · CPU / GL / GPU</th></tr></thead><tbody>
    ${rows.filter(r => r.variant === 'Original').map(r => {
    const s = r.anchor; const id = (n: number | null): string => n === null ? 'background' : String(n)
    return `<tr><td>${r.name}<br>(${s.x}, ${s.y})</td><td>${id(s.cpu)} / ${id(s.webgl)} / ${id(s.webgpu)}</td>
      <td>${s.carrier.webgl} / ${s.carrier.webgpu}</td><td>${s.coverage.cpu} / ${s.coverage.webgl} / ${s.coverage.webgpu}</td>
      <td>${s.caps.start} / ${s.caps.end}</td><td>${s.exactTriangles.cpu} / ${s.exactTriangles.webgl} / ${s.exactTriangles.webgpu}</td></tr>`
  }).join('')}</tbody></table>
    <h3>Identical-vertex carrier replay</h3><p>The WebGL-captured clip positions feed trivial shaders on both APIs.
      No production vertex math or coverage discard remains. Native differences compare each API's own captured geometry with its float carrier probe.</p>
    <table data-raster-fixed><thead><tr><th>Original source</th><th>GL/GPU captures equal</th><th>Different carrier pixels with identical vertices</th>
      <th>Replay / native differences · GL / GPU</th></tr></thead><tbody>
    ${rows.filter(r => r.variant === 'Original').map(r => `<tr><td>${r.name}</td><td>${r.carrierReplay.sameCapturedVertices}</td>
      <td>${r.carrierReplay.fixedVertexDifferences}</td>
      <td>${r.carrierReplay.webglNativeDifferences} / ${r.carrierReplay.webgpuNativeDifferences}</td></tr>`).join('')}</tbody></table>
    <h3>Endpoint reversal</h3><p>Solid per-link colors and widths are unchanged. These supporting counts compare the same mathematical ribbon
      with its endpoints swapped; they do not replace the original acceptance gate.</p>
    <table data-raster-reversal><thead><tr><th>Source</th><th>Changed IDs · CPU / GL / GPU</th><th>Changed color pixels · GL / GPU</th></tr></thead><tbody>
    ${rows.filter(r => r.reversal).map(r => `<tr><td>${r.name}</td><td>${r.reversal!.cpuIds} / ${r.reversal!.webglIds} / ${r.reversal!.webgpuIds}</td>
      <td>${r.reversal!.webglColors.changedPixels} / ${r.reversal!.webgpuColors.changedPixels}</td></tr>`).join('')}</tbody></table>`
}
