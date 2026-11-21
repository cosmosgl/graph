import { pick } from '../../gpu/rgba-readback'
import type { Snapshot } from './backend'
import { productionGeometry } from './geometry'
import { DEFAULTS, fixture, WIDTH, HEIGHT, type Settings } from './data'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'
import { createReplay } from './replay'
import { mesh, reference } from './reference'
const cross = (a: number[], b: number[], p: number[]): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
export function interpolateCapture (clip: number[], sides: number[], width: number, height: number, x: number, y: number):
Array<{ triangle: number; area: number; side: number; weights: number[] }> {
  const vertices = sides.map((side, i) => [(clip[i * 2] + 1) * width / 2, (1 - clip[i * 2 + 1]) * height / 2, side])
  const result = []
  for (let i = 0; i + 2 < vertices.length; i++) {
    const v = i % 2 ? [vertices[i + 1], vertices[i], vertices[i + 2]] : vertices.slice(i, i + 3)
    const area = cross(v[0], v[1], v[2]); if (!area) continue
    const weights = [cross(v[1], v[2], [x + 0.5, y + 0.5]), cross(v[2], v[0], [x + 0.5, y + 0.5]),
      cross(v[0], v[1], [x + 0.5, y + 0.5])].map(n => n / area)
    if (weights.some(n => n < 0)) continue
    result.push({ triangle: i, area, side: weights.reduce((sum, n, i) => sum + n * v[i][2], 0), weights })
  }
  return result
}
export function vertexClip (image: Snapshot): number[] {
  if (!image.probe) throw new Error('Missing diagnostic vertex capture')
  return Array.from(image.probe.vertices).filter((_, i) => i % 4 < 2)
}
export type Witness = { x: number; y: number; id: number | null; color: number[]; varying: number[];
  interpolation: ReturnType<typeof interpolateCapture>; vertices: number[]; }
export function boundaryWitness (image: Snapshot, settings: Settings, x: number, y: number): Witness {
  if (!image.probe) throw new Error('Missing diagnostic varying capture')
  const pixel = (y * image.width + x) * 4; const clip = vertexClip(image)
  const sides = Array.from(productionGeometry(settings)).filter((_, i) => i % 2 === 1)
  return {
    x,
    y,
    id: pick(image, x, y),
    color: Array.from(image.color.subarray(pixel, pixel + 4)),
    varying: Array.from(image.probe.varying.subarray(pixel, pixel + 4)),
    interpolation: interpolateCapture(clip, sides, image.width, image.height, x, y),
    vertices: clip,
  }
}
export type ReplayRow = { geometry: string; backend: string; pixel: number[]; cutoff: boolean; carrierDifferences: number; cutoffDifferences: number }
export type Pixel = { id: number | null; color: number[] }
export type BowReport = { settings: Settings; devices: string[]; native: { webgl: Witness; webgpu: Witness };
  cpu: Pixel & { interpolation: ReturnType<typeof interpolateCapture> }; hard: { webgl: Pixel; webgpu: Pixel }; replays: ReplayRow[]; }
// Readbacks explain the rejection. They never supply acceptance masks.
export async function investigateBow (): Promise<BowReport> {
  const settings = DEFAULTS; const input = fixture('bows'); const scene = { ...input, links: [input.links[1]] }
  const gl = await createCurvesWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  let replayGl: Awaited<ReturnType<typeof createReplay>> | undefined; let replayGpu: typeof replayGl
  try {
    gpu = await createCurvesWebGPU(document.createElement('canvas'))
    const a = await gl.render(scene, settings, 'visible', false, true); const b = await gpu.render(scene, settings, 'visible', false, true)
    const hardA = await gl.render(scene, { ...settings, blend: false }, 'visible', false)
    const hardB = await gpu.render(scene, { ...settings, blend: false }, 'visible', false)
    const sample = (image: Snapshot): Pixel => ({
      id: pick(image, 352, 85),
      color: Array.from(image.color.subarray((85 * WIDTH + 352) * 4,
        (85 * WIDTH + 353) * 4)),
    })
    const ref = reference(scene, settings); const triangles = mesh(scene, settings, false, 'visible')
    const vertices = [triangles[0].vertices[0], triangles[0].vertices[1], ...triangles.map(t => t.vertices[2])]
    const cpuClip = Array.from(new Float32Array(vertices.flatMap(v => [v.xy[0] / WIDTH * 2 - 1, 1 - v.xy[1] / HEIGHT * 2])))
    const sides = Array.from(productionGeometry(settings)).filter((_, i) => i % 2 === 1)
    replayGl = await createReplay('webgl'); replayGpu = await createReplay('webgpu'); const rows: ReplayRow[] = []
    const pixel = (85 * WIDTH + 352) * 4
    for (const [geometry, clip] of [['WebGL capture', vertexClip(a)], ['WebGPU capture', vertexClip(b)], ['CPU rounded', cpuClip]] as const) {
      for (const [backend, replay, original, linear] of [['WebGL', replayGl, a, false], ['WebGPU', replayGpu, b, false],
        ['WebGPU linear', replayGpu, b, true]] as const) {
        const result = await replay.draw({ clip, sides, smoothing: a.probe!.varying[pixel + 1], width: WIDTH, height: HEIGHT }, linear)
        let carrierDifferences = 0; let cutoffDifferences = 0
        for (let i = 0; i < result.length; i += 4) {
          const native = original.probe!.varying
          if (!!result[i + 3] !== !!native[i + 3]) carrierDifferences++
          if ((!!result[i + 3] && result[i + 2] >= 0.5) !== (!!native[i + 3] && native[i + 2] >= 0.5)) cutoffDifferences++
        }
        rows.push({
          geometry,
          backend,
          pixel: Array.from(result.subarray(pixel, pixel + 4)),
          cutoff: result[pixel + 3] !== 0 && result[pixel + 2] >= 0.5,
          carrierDifferences,
          cutoffDifferences,
        })
      }
    }
    return {
      settings,
      devices: [gl.info, gpu.info],
      native: {
        webgl: boundaryWitness(a, settings, 352, 85),
        webgpu: boundaryWitness(b, settings, 352, 85),
      },
      cpu: {
        id: ref.ids.visible[85 * WIDTH + 352],
        color: Array.from(ref.color.subarray(pixel, pixel + 4)),
        interpolation: interpolateCapture(cpuClip, sides, WIDTH, HEIGHT, 352, 85),
      },
      hard: { webgl: sample(hardA), webgpu: sample(hardB) },
      replays: rows,
    }
  } finally { replayGpu?.destroy(); replayGl?.destroy(); gpu?.destroy(); gl.destroy() }
}
export function renderBowReport (host: HTMLElement, report: BowReport): void {
  const pixelRow = (label: string, pixel: Pixel, varying?: number[]): string => `<tr><td>${label}</td>
    <td>${pixel.id === null ? 'Background' : `Link ${pixel.id}`}</td><td>${pixel.color.join(', ')}</td>
    <td>${varying ? varying[0].toPrecision(10) : '—'}</td><td>${varying ? varying[2].toPrecision(10) : '—'}</td></tr>`
  host.innerHTML = `<h3>Default-bow pixel (352, 85)</h3><p>Isolated amber source; original 19-segment curve, weight 0.8, bow 0.5.
    The half-coverage cutoff remains 0.5. Readbacks and replays explain failures and never supply acceptance masks.</p>
    <table data-bow-native><thead><tr><th>Witness</th><th>Selected ID</th><th>RGBA8</th><th>Interpolated side</th><th>Coverage</th></tr></thead><tbody>
    ${pixelRow('Blended WebGL', report.native.webgl, report.native.webgl.varying)}
    ${pixelRow('Blended WebGPU', report.native.webgpu, report.native.webgpu.varying)}
    ${pixelRow('Blended CPU', report.cpu)}${pixelRow('Hard WebGL', report.hard.webgl)}${pixelRow('Hard WebGPU', report.hard.webgpu)}</tbody></table>
    <p>Smoothing is ${report.native.webgl.varying[1].toPrecision(10)} in both native probes.
      CPU-rounded vertices put the pixel inside triangle ${report.cpu.interpolation[0]?.triangle}, with a double-precision side of
      ${report.cpu.interpolation[0]?.side.toPrecision(10)}. The independent unrounded CPU rasterizer supplies its own mask and color above.</p>
    <table data-bow-replay><thead><tr><th>Identical geometry input</th><th>Backend</th><th>Side</th><th>Coverage</th>
    <th>Selected at 0.5</th><th>Carrier differences</th><th>Cutoff differences</th></tr></thead><tbody>
    ${report.replays.map(row => `<tr><td>${row.geometry}</td><td>${row.backend}</td><td>${row.pixel[0].toPrecision(10)}</td>
      <td>${row.pixel[2].toPrecision(10)}</td><td>${row.cutoff ? 'Yes' : 'No'}</td>
      <td>${row.carrierDifferences}</td><td>${row.cutoffDifferences}</td></tr>`).join('')}</tbody></table>
    <p>Differences compare each replay with its backend’s native isolated bow across the whole framebuffer.
      Raw vertex captures and unrounded values are included in Export JSON.</p>`
}
