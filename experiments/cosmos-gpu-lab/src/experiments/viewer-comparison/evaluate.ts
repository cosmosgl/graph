import { workload } from '../integrated-webgpu/data'
import { nextFrame, type Integrated } from '../integrated-webgpu/runtime'
import { percentiles } from '../integrated-webgpu/evaluate'
import { fit, validateFrame } from '../integrated-webgpu/validation'
import { stress, stressPairs } from '../matched-layout/metrics'
import { styles } from './styles'
import type { Production } from './production'
export const protocol = 'Karate Club 34 points / 78 weighted links; seed 29471, default corrected candidate and matched core-force settings. ' +
  'Equal measured CSS panel widths × 320 px at actual DPR. Public host-driven frames, one GPU completion in flight. ' +
  'Per viewer: 60 warmup ticks, Fit, 300 early intervals; cool to tick 5000, Fit, 300 paused redraw intervals. ' +
  'Time one viewer at a time, other paused. Readbacks/quality outside timing. Then style A/B, 32-point chain replacement and Karate restoration, ' +
  'resize, recreation; actual picking and dragging during running. Frame target ≥95% ≤33 ms; feedback ≤50 ms. ' +
  'Exact point IDs and original one-device-pixel / two-byte rendering rules remain unchanged.'
export type FrameRow = { backend: string; window: string; intervals: number[]; p95: number; within33: number; pass: boolean }
type ColorWitness = { x: number; y: number; colors: number[][]; points: number[][]; links: number[][] }
type ColorAttribution = Record<'points' | 'links' | 'both' | 'composed', { count: number; witness?: ColorWitness }>
export type PaintComparison = {
  samples: number; boundarySamples: number; boundaryColorFailures: number; interiorIdFailures: number; interiorColorFailures: number;
  productionInvisiblePicks: number; candidateInvisiblePicks: number; nonempty: boolean; geometry: number[]; maxColorError: number;
  camera: [number, number, number];
  smoothLinks?: true;
  colorAttribution?: ColorAttribution;
}
function colorError (a: Uint8Array, b: Uint8Array, offset: number): number {
  return Math.max(
    Math.abs(a[offset] - b[offset]), Math.abs(a[offset + 1] - b[offset + 1]),
    Math.abs(a[offset + 2] - b[offset + 2]), Math.abs(a[offset + 3] - b[offset + 3])
  )
}
export async function assessViewers (
  gl: Production, gpu: Integrated, guard: () => void, progress: (s: string) => void, record: (row: unknown) => void
): Promise<void> {
  const quality = (positions: Float32Array): { stress: number | null; finite: boolean; positions: number[] } => ({
    stress: stress(positions, stressPairs(workload('karate').graph).pairs).rms,
    finite: Array.from(positions).every(Number.isFinite),
    positions: Array.from(positions),
  })
  for (const backend of ['Production WebGL', 'luma WebGPU']) {
    guard(); const webgl = backend === 'Production WebGL'
    if (webgl) await gl.replace('karate')
    else {
      await gpu.replace('karate', 34)
      const baseline = styles(34, false)
      baseline.sizes.forEach((size, i) => gpu.renderer.setStyle(i, Array.from(baseline.colors.subarray(i * 4, i * 4 + 4)), size))
      gpu.renderer.setLinkStyle(baseline.link, baseline.width)
    }
    const frame = async (simulate: boolean): Promise<void> => { if (webgl) await gl.frame(simulate); else await gpu.frame(simulate) }
    const positions = async (): Promise<Float32Array> => webgl ? gl.positions() : (await gpu.backend.read()).positions
    const fitView = async (): Promise<void> => { if (webgl) gl.fit(); else fit(gpu, await positions()); await frame(false) }
    const advance = async (from: number, to: number): Promise<void> => {
      for (let i = from; i < to; i++) {
        guard(); await nextFrame(); await frame(true)
        if (i % 120 === 0) progress(`${backend} · cooling ${i + 1}/${to}`)
      }
    }
    const measure = async (name: string, simulate: boolean): Promise<void> => {
      const intervals: number[] = []; let previous = await nextFrame()
      for (let i = 0; i < 300; i++) {
        guard(); await frame(simulate); const now = await nextFrame(); intervals.push(now - previous); previous = now
      }
      const within33 = intervals.filter(v => v <= 33).length / intervals.length
      record({ backend, window: name, intervals, p95: percentiles(intervals).p95, within33, pass: within33 >= 0.95 } satisfies FrameRow)
    }
    await advance(0, 60); await fitView(); progress(`${backend} · early 300-frame window`)
    await measure('Ticks 61–360', true); record({ backend, checkpoint: 360, actualTick: webgl ? gl.tick : gpu.tick, ...quality(await positions()) })
    await advance(360, 5000); await fitView(); record({ backend, checkpoint: 5000, actualTick: webgl ? gl.tick : gpu.tick, ...quality(await positions()) })
    progress(`${backend} · cooled 300-redraw window`); await measure('Cooled redraw, simulation paused', false)
    if (!webgl) record({ backend, pixelAudit: await validateFrame(gpu) })
  }
}
// Same frozen candidate geometry and camera, using production's public setters and host drawing.
// This does not replace independently evolved layout-quality comparison.
export async function comparePaint (
  gl: Production, gpu: Integrated, { attributeLayers = false, smoothLinks = false } = {}
): Promise<PaintComparison> {
  const positions = (await gpu.backend.read()).positions
  const w = gpu.canvas.width / gpu.renderer.ratio; const h = gpu.canvas.height / gpu.renderer.ratio
  const c = gpu.renderer.camera
  gl.graph.setPointPositions(Float32Array.from({ length: positions.length / 2 }, (_, i) => positions[Math.floor(i / 2) * 4 + i % 2] + 2048), true)
  gl.graph.render(undefined, 0); gl.graph.pause()
  gl.graph.setViewTransform({ k: c.zoom, x: w / 2 - c.zoom * (c.x + w / 2), y: h / 2 + c.zoom * (c.y - h / 2) }, [w, h])
  await gl.frame(false)
  const a = gl.snapshot(); const ai = gl.snapshot(true); const b = await gpu.renderer.snapshot({ smoothLinks })
  if (a.length !== b.color.length) throw new Error('Paired render attachment sizes differ')
  const result: PaintComparison = {
    geometry: Array.from(positions),
    camera: [c.x, c.y, c.zoom],
    ...(smoothLinks ? { smoothLinks: true } : {}),
    maxColorError: 0,
    samples: 0,
    boundarySamples: 0,
    boundaryColorFailures: 0,
    interiorIdFailures: 0,
    interiorColorFailures: 0,
    productionInvisiblePicks: 0,
    candidateInvisiblePicks: 0,
    nonempty: a.some((v, i) => i % 4 === 3 && v > 0) && b.color.some((v, i) => i % 4 === 3 && v > 0),
  }
  const layers = attributeLayers
    ? {
      points: [gl.snapshot(false, { links: false }), await gpu.renderer.snapshotColor({ links: false })],
      links: [gl.snapshot(false, { points: false }), await gpu.renderer.snapshotColor({ points: false, smoothLinks })],
    }
    : undefined
  const attribution: ColorAttribution | undefined = layers
    ? { points: { count: 0 }, links: { count: 0 }, both: { count: 0 }, composed: { count: 0 } }
    : undefined
  if (layers && Object.values(layers).flat().some(layer => layer.length !== a.length)) {
    throw new Error('Isolated paint attachment sizes differ')
  }
  const points = Array.from({ length: positions.length / 4 }, (_, i) => {
    const [x, y] = gpu.screen(positions[i * 4], positions[i * 4 + 1])
    return { x, y, radius: gpu.renderer.styles[i * 8 + 4] * gpu.renderer.ratio / 2, alpha: gpu.renderer.styles[i * 8 + 3] }
  })
  for (let y = 0; y < b.height; y++) {
    // Immutable snapshots: yield during the CPU audit so the page stays responsive.
    if (y % 32 === 0) await nextFrame()
    for (let x = 0; x < b.width; x++) {
      const o = (y * b.width + x) * 4
      const idA = ai[o] + ai[o + 1] * 256 + ai[o + 2] * 65536
      const idB = b.ids[o] + b.ids[o + 1] * 256 + b.ids[o + 2] * 65536
      if (idA && (points[idA - 1]?.alpha === 0 || a[o + 3] === 0)) result.productionInvisiblePicks++
      if (idB && (points[idB - 1]?.alpha === 0 || b.color[o + 3] === 0)) result.candidateInvisiblePicks++
      let boundary = points.some(p => p.alpha > 0 && p.radius > 0 && Math.abs(Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) - p.radius) <= 1)
      for (let e = 0; !boundary && e < gpu.data.graph.links.length; e += 2) {
        const p = points[gpu.data.graph.links[e]]; const q = points[gpu.data.graph.links[e + 1]]
        const dx = q.x - p.x; const dy = q.y - p.y; const length = Math.hypot(dx, dy); if (!length) continue
        const along = ((x + 0.5 - p.x) * dx + (y + 0.5 - p.y) * dy) / length
        const across = Math.abs(((x + 0.5 - p.x) * dy - (y + 0.5 - p.y) * dx) / length)
        const half = gpu.renderer.linkStyle.width * gpu.renderer.ratio / 2
        boundary = along >= -1 && along <= length + 1 && across <= half + 1 &&
        (Math.abs(across - half) <= 1 || Math.abs(along) <= 1 || Math.abs(along - length) <= 1)
      }
      const error = colorError(a, b.color, o)
      result.samples++
      if (boundary) {
        result.boundarySamples++
        if (error > 2) result.boundaryColorFailures++
        continue
      }
      if (idA !== idB) result.interiorIdFailures++
      result.maxColorError = Math.max(result.maxColorError, error)
      if (error <= 2) continue
      result.interiorColorFailures++
      if (layers && attribution) {
        const pointsDiffer = colorError(layers.points[0], layers.points[1], o) > 2
        const linksDiffer = colorError(layers.links[0], layers.links[1], o) > 2
        let group = attribution.composed
        if (pointsDiffer && linksDiffer) group = attribution.both
        else if (pointsDiffer) group = attribution.points
        else if (linksDiffer) group = attribution.links
        group.count++
        if (!group.witness) {
          const rgba = (pair: Uint8Array[]): number[][] => pair.map(bytes => Array.from(bytes.subarray(o, o + 4)))
          group.witness = { x, y, colors: rgba([a, b.color]), points: rgba(layers.points), links: rgba(layers.links) }
        }
      }
    }
  }
  if (attribution) result.colorAttribution = attribution
  return result
}
