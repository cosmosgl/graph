import { sourceAlphaByte } from '../../gpu/source-alpha'
import { pick } from '../../gpu/rgba-readback'
import { compareColors, type Comparison as BaseComparison } from '../straight-links/reference'
import { WIDTH, HEIGHT, resolveLink, validateCurve, type Scene, type Settings, type Variant } from './data'
import type { Snapshot } from './backend'
export type Vec = [number, number]
export type Vertex = { xy: Vec; side: number }
export type Triangle = { vertices: Vertex[]; area: number; id: number; color: number[]; alpha: number; smoothing: number }
export function nodes (segments: number): number[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const x = 2 * i / segments - 1
    return Math.fround((1 + Math.sign(x) * x * x) / 2)
  })
}
export function conicPoint (a: Vec, b: Vec, c: Vec, t: number, w: number): Vec {
  const u = 1 - t; const weights = [u * u, 2 * u * t * w, t * t]; const denominator = weights.reduce((x, y) => x + y, 0)
  return [0, 1].map(i => (weights[0] * a[i] + weights[1] * c[i] + weights[2] * b[i]) / denominator) as Vec
}
function cross (a: Vec, b: Vec, p: Vec): number { return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) }
export function mesh (scene: Scene, settings: Settings, picking: boolean, variant: Variant): Triangle[] {
  validateCurve(settings); const triangles: Triangle[] = []; const order = scene.links.map((_, i) => i)
  if (settings.reverse) order.reverse()
  const samples = nodes(settings.segments); const w = Math.fround(settings.weight); const h = Math.fround(settings.controlDistance)
  for (const id of order) {
    const link = resolveLink(scene.links[id], settings); const pa = scene.points[link.source]; const pb = scene.points[link.target]
    if (pa.absent || pb.absent || link.width * settings.widthScale <= 0) continue
    const a: Vec = [Math.fround(pa.x - WIDTH / 2), Math.fround(HEIGHT / 2 - pa.y)]
    const b: Vec = [Math.fround(pb.x - WIDTH / 2), Math.fround(HEIGHT / 2 - pb.y)]
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const length = Math.hypot(dx, dy)
    if (!length) continue // The original shader's zero-normal result is not portable.
    const control: Vec = [(a[0] + b[0]) / 2 - dy * h, (a[1] + b[1]) / 2 + dx * h]
    const zoomWidth = settings.scaleOnZoom ? settings.zoom : Math.min(5, Math.max(1, settings.zoom * 0.01))
    let width = Math.min(link.width * settings.widthScale * zoomWidth, settings.maxWidth) * settings.ratio
    if (picking && variant === 'production') width += 5 * settings.ratio
    const carrier = Math.max(width, 1) + 1; const worldCarrier = carrier / (settings.zoom * settings.ratio)
    const color = link.color.map(Math.fround)
    const thin = settings.blend ? Math.min(width, 1) : 1
    const alpha = Math.fround(Math.fround(color[3] * Math.fround(settings.opacity)) * Math.fround(thin))
    const vertices: Vertex[] = []
    for (const t of samples) {
      const p = conicPoint(a, b, control, t, w)
      const prev = conicPoint(a, b, control, Math.max(0, t - 1 / settings.segments), w)
      const next = conicPoint(a, b, control, Math.min(1, t + 1 / settings.segments), w)
      const tx = next[0] - prev[0]; const ty = next[1] - prev[1]; const size = Math.hypot(tx, ty)
      for (const side of [0.5, -0.5]) {
        const x = p[0] - ty / size * worldCarrier * side; const y = p[1] + tx / size * worldCarrier * side
        vertices.push({ xy: [(WIDTH / 2 + x * settings.zoom) * settings.ratio, (HEIGHT / 2 - y * settings.zoom) * settings.ratio], side })
      }
    }
    for (let i = 0; i < vertices.length - 2; i++) {
      const v = i % 2 ? [vertices[i + 1], vertices[i], vertices[i + 2]] : vertices.slice(i, i + 3)
      const area = cross(v[0].xy, v[1].xy, v[2].xy)
      if (area) triangles.push({ vertices: v, area, id: id + settings.indexOffset, color, alpha, smoothing: 1 / carrier })
    }
  }
  return triangles
}
function raster (triangles: Triangle[], width: number, height: number, visit: (t: Triangle, i: number, coverage: number) => void): void {
  for (const triangle of triangles) {
    const v = triangle.area < 0 ? [triangle.vertices[0], triangle.vertices[2], triangle.vertices[1]] : triangle.vertices
    const a = v[0].xy; const b = v[1].xy; const c = v[2].xy; const area = Math.abs(triangle.area)
    const bounds = (axis: number, size: number): [number, number] => [Math.max(0, Math.ceil(Math.min(...v.map(p => p.xy[axis])) - 0.5)),
      Math.min(size - 1, Math.floor(Math.max(...v.map(p => p.xy[axis])) - 0.5))]
    const [left, right] = bounds(0, width); const [top, bottom] = bounds(1, height)
    const edge = (n: number, u: Vec, v: Vec): boolean => n > 0 || (n === 0 && (v[1] < u[1] || (v[1] === u[1] && v[0] > u[0])))
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const p: Vec = [x + 0.5, y + 0.5]; const e0 = cross(b, c, p); const e1 = cross(c, a, p); const e2 = cross(a, b, p)
        if (!edge(e0, b, c) || !edge(e1, c, a) || !edge(e2, a, b)) continue
        const side = (e0 * v[0].side + e1 * v[1].side + e2 * v[2].side) / area
        const t = Math.max(0, Math.min(1, (0.5 - Math.abs(side)) / triangle.smoothing))
        visit(triangle, y * width + x, t * t * (3 - 2 * t))
      }
    }
  }
}
export type Reference = { width: number; height: number; color: Uint8Array; ids: Record<Variant, Int32Array>; triangles: number }
export function reference (scene: Scene, settings: Settings): Reference {
  const width = WIDTH * settings.ratio; const height = HEIGHT * settings.ratio; const color = new Uint8Array(width * height * 4)
  const visible = mesh(scene, settings, false, 'visible'); const ids = {
    production: new Int32Array(width * height).fill(-1),
    visible: new Int32Array(width * height).fill(-1),
    front: new Int32Array(width * height).fill(-1),
  }
  // Color follows production back-face culling; host IDs use its unculled pass.
  raster(visible.filter(t => t.area < 0), width, height, (tri, i, coverage) => {
    if (!settings.blend && (coverage < 0.5 || tri.alpha <= 0)) return
    const alpha = settings.blend ? Math.max(0, Math.min(1, Math.fround(tri.alpha * Math.fround(coverage)))) : 1
    for (let c = 0; c < 3; c++) color[i * 4 + c] = Math.round((tri.color[c] * alpha + color[i * 4 + c] / 255 * (1 - alpha)) * 255)
    color[i * 4 + 3] = Math.round((alpha + color[i * 4 + 3] / 255 * (1 - alpha)) * 255)
  })
  for (const variant of ['production', 'visible', 'front'] as const) {
    const triangles = variant === 'production' ? mesh(scene, settings, true, variant) : variant === 'front' ? visible.filter(t => t.area < 0) : visible
    raster(triangles, width, height, (tri, i, coverage) => {
      if (coverage < 0.5 || tri.alpha <= 0) return
      if (variant !== 'production' && settings.blend && sourceAlphaByte(Math.fround(tri.alpha * Math.fround(coverage))) === 0) return
      ids[variant][i] = tri.id
    })
  }
  return { width, height, color, ids, triangles: visible.length }
}
export type Comparison = BaseComparison & { firstColorMismatch?: { x: number; y: number; webgl: number[]; webgpu: number[]; cpu: number[] } }
export async function compare (a: Snapshot, b: Snapshot, ref: Reference): Promise<Comparison> {
  if (a.width !== b.width || a.height !== b.height || a.width !== ref.width || a.height !== ref.height) throw new Error('Framebuffer dimensions differ')
  const result: Comparison = {
    pixels: a.width * a.height,
    idDifferences: 0,
    masks: { webgl: 0, webgpu: 0 },
    invisible: { webgl: 0, webgpu: 0 },
    colors: compareColors(a.color, b.color),
    cpuColors: { webgl: compareColors(a.color, ref.color), webgpu: compareColors(b.color, ref.color) },
    passed: false,
  }
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const index = y * a.width + x; const gl = pick(a, x, y); const gpu = pick(b, x, y)
      const u = ref.ids[a.variant][index] < 0 ? null : ref.ids[a.variant][index]; const v = ref.ids[b.variant][index] < 0 ? null : ref.ids[b.variant][index]
      if (gl !== gpu) result.idDifferences++
      if (gl !== u) result.masks.webgl++
      if (gpu !== v) result.masks.webgpu++
      if (gl !== null && a.color[index * 4 + 3] === 0) result.invisible.webgl++
      if (gpu !== null && b.color[index * 4 + 3] === 0) result.invisible.webgpu++
      if (gl !== gpu || gl !== u || gpu !== v) result.firstMismatch ??= { x, y, webgl: gl, webgpu: gpu, expected: { webgl: u, webgpu: v } }
      if (!result.firstColorMismatch && [0, 1, 2, 3].some(c => Math.max(Math.abs(a.color[index * 4 + c] - b.color[index * 4 + c]),
        Math.abs(a.color[index * 4 + c] - ref.color[index * 4 + c]), Math.abs(b.color[index * 4 + c] - ref.color[index * 4 + c])) > 2)) {
        const rgba = (data: Uint8Array): number[] => Array.from(data.subarray(index * 4, index * 4 + 4))
        result.firstColorMismatch = { x, y, webgl: rgba(a.color), webgpu: rgba(b.color), cpu: rgba(ref.color) }
      }
    }
    if (y % 16 === 15) await new Promise<void>(resolve => { setTimeout(resolve, 0) })
  }
  result.passed = result.idDifferences === 0 && result.masks.webgl === 0 && result.masks.webgpu === 0 &&
    result.invisible.webgl === 0 && result.invisible.webgpu === 0 && result.colors.budgetFailures === 0 &&
    result.cpuColors.webgl.budgetFailures === 0 && result.cpuColors.webgpu.budgetFailures === 0
  return result
}
