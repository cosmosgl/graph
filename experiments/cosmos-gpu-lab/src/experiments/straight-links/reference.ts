import { pick } from '../../gpu/rgba-readback'
import { sourceAlphaByte } from '../../gpu/source-alpha'
import { patternCode, patternCoverage, type PatternGeometry } from './patterns'
import { HEIGHT, WIDTH, resolveLink, type Scene, type Settings, type Variant } from './data'
import type { Snapshot } from './backend'
import { resolvedEndpointColor } from './endpoint-colors'
type Vec = [number, number]
type Ribbon = { pattern?: PatternGeometry; id: number; a: Vec; b: Vec; normal: Vec; length: number; core: number; thin: number; color: number[];
  endpointColors?: number[][]; vertices: Vec[]; left: number; top: number; right: number; bottom: number; }
// Signed distance in device pixels to the sides, butt caps and corners of the visible ribbon.
export function outlineDistance (r: Ribbon, x: number, y: number): number {
  const dx = x - r.a[0]; const dy = y - r.a[1]
  const [nx, ny] = r.normal
  const along = Math.abs(-ny * dx + nx * dy - r.length / 2) - r.length / 2
  const across = Math.abs(nx * dx + ny * dy) - r.core / 2
  return along > 0 && across > 0 ? Math.hypot(along, across) : Math.max(along, across)
}

export function colorOutsideBudget (a: Uint8Array, b: Uint8Array, reference: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + 4; i++) {
    if (Math.max(a[i], b[i], reference[i]) - Math.min(a[i], b[i], reference[i]) > 2) return true
  }
  return false
}

function triangle (p: Vec, a: Vec, b: Vec, c: Vec): boolean {
  const cross = (a: Vec, b: Vec, p: Vec): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
  if (cross(a, b, c) < 0) [b, c] = [c, b]
  return [[a, b], [b, c], [c, a]].every(([u, v]) => {
    const edge = cross(u, v, p); const dx = v[0] - u[0]; const dy = v[1] - u[1]
    return edge > 0 || (edge === 0 && (dy < 0 || (dy === 0 && dx > 0)))
  })
}
export function ribbons (scene: Scene, settings: Settings, picking: boolean, variant: Variant): Ribbon[] {
  const order = scene.links.map((_, i) => i); if (settings.reverse) order.reverse()
  return order.flatMap(index => {
    const link = resolveLink(scene.links[index], settings); const pa = scene.points[link.source]; const pb = scene.points[link.target]
    if (pa.absent || pb.absent || link.width * settings.widthScale <= 0) return []
    const screen = (p: typeof pa): Vec => [(WIDTH / 2 + (p.x - WIDTH / 2) * settings.zoom) * settings.ratio,
      (HEIGHT / 2 + (p.y - HEIGHT / 2) * settings.zoom) * settings.ratio]
    const a = screen(pa); const b = screen(pb); const dx = b[0] - a[0]; const dy = b[1] - a[1]; const length = Math.hypot(dx, dy)
    if (length === 0) return []
    const normal: Vec = [dy / length, -dx / length]
    const zoom = settings.scaleOnZoom ? settings.zoom : Math.min(5, Math.max(1, settings.zoom * 0.01))
    let width = Math.min(link.width * settings.widthScale * zoom, settings.maxWidth) * settings.ratio
    if (picking && variant === 'production') width += 5 * settings.ratio
    const core = Math.max(width, 1); const half = (core + 1) * 0.5
    const shift = (p: Vec, sign: number): Vec => [p[0] + normal[0] * half * sign, p[1] + normal[1] * half * sign]
    const vertices = [shift(a, 1), shift(a, -1), shift(b, 1), shift(b, -1)]
    return [{
      pattern: patternCode(link, settings)
        ? {
          code: patternCode(link, settings),
          span: length / (settings.ratio * (settings.scaleOnZoom ? settings.zoom : 1)),
          width: (core + 1) / (settings.ratio * (settings.scaleOnZoom ? settings.zoom : 1)),
          smoothing: 1 / (core + 1),
          coords: (x, y) => [((x - a[0]) * dx + (y - a[1]) * dy) / (length * length),
            ((x - a[0]) * normal[0] + (y - a[1]) * normal[1]) / (core + 1)],
        }
        : undefined,
      id: index + settings.indexOffset,
      a,
      b,
      normal,
      length,
      core,
      thin: settings.blend ? Math.min(width, 1) : 1,
      color: link.color.map(Math.fround),
      endpointColors: settings.endpointColors ? [resolvedEndpointColor(pa, settings), resolvedEndpointColor(pb, settings)] : undefined,
      vertices,
      left: Math.min(...vertices.map(v => v[0])),
      right: Math.max(...vertices.map(v => v[0])),
      top: Math.min(...vertices.map(v => v[1])),
      bottom: Math.max(...vertices.map(v => v[1])),
    }]
  })
}
function fragment (r: Ribbon, x: number, y: number, settings: Settings, patterned = true): { coverage: number; alpha: number } | undefined {
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return undefined
  const v = r.vertices; const p: Vec = [x, y]
  if (!triangle(p, v[0], v[1], v[2]) && !triangle(p, v[2], v[1], v[3])) return undefined
  const distance = Math.abs((x - r.a[0]) * r.normal[0] + (y - r.a[1]) * r.normal[1])
  const t = Math.max(0, Math.min(1, (r.core + 1) * 0.5 - distance))
  const coverage = t * t * (3 - 2 * t) * (patterned ? patternCoverage(r.pattern, settings, x, y) : 1); const f = Math.fround
  return { coverage, alpha: f(f(f(r.color[3] * f(settings.opacity)) * f(r.thin)) * f(coverage)) }
}
export function scalarPick (entries: Ribbon[], settings: Settings, variant: Variant): (x: number, y: number) => number | null {
  const order = [...entries].reverse()
  return (x, y): number | null => {
    for (const r of order) {
      const sample = fragment(r, x, y, settings, variant !== 'production')
      if (!sample || sample.coverage < 0.5 || r.color[3] * settings.opacity <= 0) continue
      if (variant === 'visible' && settings.blend && sourceAlphaByte(sample.alpha) === 0) continue
      return r.id
    }
    return null
  }
}
export function cpuColors (scene: Scene, settings: Settings): Uint8Array {
  const width = WIDTH * settings.ratio; const height = HEIGHT * settings.ratio; const bytes = new Uint8Array(width * height * 4)
  for (const r of ribbons(scene, settings, false, 'visible')) {
    for (let y = Math.max(0, Math.ceil(r.top - 0.5)); y <= Math.min(height - 1, Math.floor(r.bottom - 0.5)); y++) {
      for (let x = Math.max(0, Math.ceil(r.left - 0.5)); x <= Math.min(width - 1, Math.floor(r.right - 0.5)); x++) {
        const sample = fragment(r, x + 0.5, y + 0.5, settings)
        if (!sample || (!settings.blend && (sample.coverage < 0.5 || sample.alpha <= 0))) continue
        const alpha = settings.blend ? Math.max(0, Math.min(1, sample.alpha)) : 1
        const offset = (y * width + x) * 4
        const along = r.endpointColors
          ? Math.max(0, Math.min(1, ((x + 0.5 - r.a[0]) * (r.b[0] - r.a[0]) + (y + 0.5 - r.a[1]) * (r.b[1] - r.a[1])) / (r.length * r.length)))
          : 0
        for (let c = 0; c < 3; c++) {
          const rgb = r.endpointColors ? r.endpointColors[0][c] * (1 - along) + r.endpointColors[1][c] * along : r.color[c]
          bytes[offset + c] = Math.round((rgb * alpha + bytes[offset + c] / 255 * (1 - alpha)) * 255)
        }
        bytes[offset + 3] = Math.round((alpha + bytes[offset + 3] / 255 * (1 - alpha)) * 255)
      }
    }
  }
  return bytes
}
export type ColorResult = { changedPixels: number; budgetFailures: number; maxChannelError: number }
export function compareColors (a: Uint8Array, b: Uint8Array): ColorResult {
  if (a.length !== b.length) throw new Error('Color images have different sizes')
  const result = { changedPixels: 0, budgetFailures: 0, maxChannelError: 0 }
  for (let i = 0; i < a.length; i += 4) {
    let error = 0
    for (let c = 0; c < 4; c++) error = Math.max(error, Math.abs(a[i + c] - b[i + c]))
    if (error > 0) result.changedPixels++
    if (error > 2) result.budgetFailures++
    result.maxChannelError = Math.max(error, result.maxChannelError)
  }
  return result
}
export type Comparison = { pixels: number; idDifferences: number; masks: { webgl: number; webgpu: number };
  invisible: { webgl: number; webgpu: number }; colors: ColorResult; cpuColors: { webgl: ColorResult; webgpu: ColorResult };
  edgeBand?: { firstOutside?: { x: number; y: number } };
  firstMismatch?: { x: number; y: number; webgl: number | null; webgpu: number | null; expected: { webgl: number | null; webgpu: number | null } };
  passed: boolean; }
export async function compare (a: Snapshot, b: Snapshot, scene: Scene, settings: Settings): Promise<Comparison> {
  if (a.width !== b.width || a.height !== b.height) throw new Error('Framebuffer dimensions differ')
  const reference = cpuColors(scene, settings)
  const geometry = ribbons(scene, settings, true, a.variant)
  const pilot = a.variant === 'visible' && b.variant === 'visible' && !settings.endpointColors && !geometry.some(r => r.pattern)
  const glPick = scalarPick(geometry, settings, a.variant)
  const gpuPick = scalarPick(ribbons(scene, settings, true, b.variant), settings, b.variant)
  const result: Comparison = {
    edgeBand: pilot ? {} : undefined,
    pixels: a.width * a.height,
    idDifferences: 0,
    masks: { webgl: 0, webgpu: 0 },
    invisible: { webgl: 0, webgpu: 0 },
    colors: compareColors(a.color, b.color),
    cpuColors: { webgl: compareColors(a.color, reference), webgpu: compareColors(b.color, reference) },
    passed: false,
  }
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const gl = pick(a, x, y); const gpu = pick(b, x, y); const u = glPick(x + 0.5, y + 0.5); const v = gpuPick(x + 0.5, y + 0.5)
      if (gl !== gpu) result.idDifferences++
      if (gl !== u) result.masks.webgl++
      if (gpu !== v) result.masks.webgpu++
      const alpha = (y * a.width + x) * 4 + 3
      if (gl !== null && a.color[alpha] === 0) result.invisible.webgl++
      if (gpu !== null && b.color[alpha] === 0) result.invisible.webgpu++
      const pickMismatch = gl !== gpu || gl !== u || gpu !== v
      if (result.edgeBand && !result.edgeBand.firstOutside && (pickMismatch || colorOutsideBudget(a.color, b.color, reference, alpha - 3))) {
        const nearEdge = geometry.some(r => r.color[3] * settings.opacity > 0 && (!pickMismatch || r.id === gl || r.id === gpu || r.id === u || r.id === v) &&
          Math.abs(outlineDistance(r, x + 0.5, y + 0.5)) <= 1)
        if (!nearEdge) result.edgeBand.firstOutside = { x, y }
      }
      if (pickMismatch) result.firstMismatch ??= { x, y, webgl: gl, webgpu: gpu, expected: { webgl: u, webgpu: v } }
    }
    if (y % 16 === 15) await new Promise<void>(resolve => { setTimeout(resolve, 0) })
  }
  result.passed = result.idDifferences === 0 && result.masks.webgl === 0 && result.masks.webgpu === 0 &&
    result.invisible.webgl === 0 && result.invisible.webgpu === 0 && result.colors.budgetFailures === 0 &&
    result.cpuColors.webgl.budgetFailures === 0 && result.cpuColors.webgpu.budgetFailures === 0
  return result
}
