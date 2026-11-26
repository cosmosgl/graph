import { pick, type PickingRule, type Snapshot } from './backend'
import { center, diameter, resolvePoint, type Point, type Settings } from './data'
import { sourceAlphaByte } from './source-alpha'
import { IMAGE_COUNT, atlasInfo, sampleAtlasPolicy } from './atlas'
import { sampleDynamicPixel, samplePackingPixel } from './atlas-packing'
import { bodyOpacity, fillColor, greyed, greyRgb, pointOrder, spriteDiameter, strokeColor, shapeInradius } from './point-effects'
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x))
// Independent scalar geometry control. This does not read a GPU mask or shader output.
export function shapeDistance (x: number, y: number, shape: number): number {
  if (shape === 0) return Math.hypot(x, y) - 1
  x = Math.abs(x)
  if (shape === 1 || shape === 7) {
    if (shape === 7) { y = Math.abs(y); if (y > x) [x, y] = [y, x] }
    const a = x - 0.8; const b = Math.abs(y) - (shape === 1 ? 0.8 : 0.3)
    return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0)
  }
  if (shape === 2) {
    x -= 0.9; y += 0.55
    const k = Math.sqrt(3)
    if (x + k * y > 0) [x, y] = [(x - k * y) / 2, (-k * x - y) / 2]
    x -= clamp(x, -1.8, 0)
    return -Math.hypot(x, y) * Math.sign(y)
  }
  if (shape === 3) {
    y = Math.abs(y); const bx = 0.8; const by = bx * 1.2
    const h = clamp(((bx - 2 * x) * bx - (by - 2 * y) * by) / (bx * bx + by * by), -1, 1)
    return Math.hypot(x - 0.5 * bx * (1 - h), y - 0.5 * by * (1 + h)) * Math.sign(x * by + y * bx - bx * by)
  }
  if (shape === 4) {
    for (const kx of [-0.809016994, 0.809016994]) {
      const projection = 2 * Math.min(x * kx + y * 0.587785252, 0)
      x -= projection * kx; y -= projection * 0.587785252
    }
    const r = 0.726542528
    x -= clamp(x, -r * r, r * r); y -= r
    return Math.hypot(x, y) * Math.sign(y)
  }
  if (shape === 5) {
    y = Math.abs(y)
    const kx = -0.866025404; const projection = 2 * Math.min(x * kx + y * 0.5, 0)
    x -= projection * kx; y -= projection * 0.5
    x -= clamp(x, -0.577350269 * 0.8, 0.577350269 * 0.8); y -= 0.8
    return Math.hypot(x, y) * Math.sign(y)
  }
  if (shape === 6) {
    for (const kx of [0.809016994, -0.809016994]) {
      const projection = 2 * Math.max(x * kx - y * 0.587785252, 0)
      x -= projection * kx; y += projection * 0.587785252
    }
    x = Math.abs(x); y -= 0.9
    const bx = 0.45 * 0.587785252; const by = 0.45 * 0.809016994 - 1
    const h = clamp((x * bx + y * by) / (bx * bx + by * by), 0, 0.9)
    return Math.hypot(x - bx * h, y - by * h) * Math.sign(y * bx - x * by)
  }
  return Infinity
}
function validImage (p: Point, settings: Settings): boolean {
  const count = settings.atlasSource?.images.length ??
    (settings.atlasPacking && settings.atlasPacking !== 'baseline' ? atlasInfo(settings.atlasPacking).imageCount : IMAGE_COUNT)
  return p.image !== undefined && p.image >= 0 && p.image < count
}
export function imageFragment (p: Point, settings: Settings, x: number, y: number):
{ imageCovered: boolean; imageAlpha: number; shapeCovered: boolean; sourceAlpha: number; color: number[] } | null {
  if (p.absent) return null
  p = resolvePoint(p, settings); const fill = fillColor(p, settings)
  const d = diameter(p, settings); const hasImage = validImage(p, settings)
  const imageD = hasImage ? diameter({ ...p, size: p.imageSize ?? p.size }, settings) : 0
  if (Math.max(d, imageD) <= 0) return null
  const sprite = spriteDiameter(p, settings, imageD); const core = Math.max(d, 1); const [cx, cy] = center(p, settings)
  if (Math.abs(x - cx) > sprite / 2 || Math.abs(y - cy) > sprite / 2) return null
  const distance = p.shape === 8 || d <= 0 ? Infinity : shapeDistance((x - cx) * 2 / core, (y - cy) * 2 / core, p.shape) * core * 0.5
  const ramp = clamp(distance + 0.5, 0, 1); const coverage = 1 - ramp * ramp * (3 - 2 * ramp)
  const area = Math.min(1, d * d / (core * core)); const f = Math.fround
  const shapeAlpha = f(f(coverage) * f(f(area) * f(fill[3])))
  const imageCovered = hasImage && imageD > 0 && Math.abs(x - cx) <= imageD / 2 && Math.abs(y - cy) <= imageD / 2
  let image = [0, 0, 0, 0]
  if (imageCovered) {
    image = settings.atlasSource
      ? sampleDynamicPixel(settings.atlasSource, p.image!, x - cx, y - cy, imageD, settings.imageFilter ?? 'nearest', settings.atlasIsolation)
      : settings.atlasPacking && settings.atlasPacking !== 'baseline' &&
      (settings.atlasIsolation === 'clamp' || settings.atlasIsolation === 'gutter' || settings.atlasIsolation === 'texel')
        ? samplePackingPixel(settings.atlasPacking, p.image!, x - cx, y - cy, imageD, settings.imageFilter ?? 'nearest')
        : sampleAtlasPolicy(p.image!, (x - cx) / imageD + 0.5, (y - cy) / imageD + 0.5,
          settings.imageFilter ?? 'nearest', settings.atlasIsolation ?? 'original', settings.atlasPacking ?? 'baseline')
  }
  if (!hasImage && (p.shape === 8 || fill[3] === 0)) return null
  if (greyed(p, settings)) image = [...greyRgb(image.slice(0, 3), settings), image[3]]
  const width = Math.min(Math.max(p.stroke, 0) * settings.ratio, d * 0.25 * shapeInradius(p.shape))
  const band = Math.abs(distance + width * 0.5) - width * 0.5; const t = clamp(band + 0.5, 0, 1)
  const stroke = width > 0 ? 1 - t * t * (3 - 2 * t) : 0
  const edge = width > 0 ? strokeColor(p, settings) : [0, 0, 0, 0]
  const color = [0, 1, 2].map(c => {
    const body = p.shape === 8 || d <= 0 ? 0 : fill[c] * (1 - stroke * edge[3]) + edge[c] * stroke * edge[3]
    return body * (1 - image[3]) + image[c] * image[3]
  })
  return {
    imageCovered,
    imageAlpha: image[3],
    shapeCovered: distance <= 0 && fill[3] > 0,
    sourceAlpha: f(Math.max(shapeAlpha, f(image[3])) * f(bodyOpacity(p, settings))),
    color,
  }
}

export function referencePick (points: Point[], settings: Settings, x: number, y: number, rule: PickingRule = 'visible'): number | null {
  // Candidate visibility is explicit. Retain the original opacity-independent
  // geometry reference for the production control; neither rule reads GPU pixels.
  if (rule === 'stored-alpha') throw new Error('Stored-alpha requires the measured per-point attachment reference')
  const order = pointOrder(points, settings).reverse()
  for (const id of order) {
    const p = resolvePoint(points[id], settings); const d = diameter(p, settings); const fill = fillColor(p, settings)
    if (rule !== 'legacy' && bodyOpacity(p, settings) <= 0) continue
    if (validImage(p, settings)) {
      const fragment = imageFragment(p, settings, x, y)
      if (!fragment) continue
      const covered = fragment.shapeCovered || (fragment.imageCovered && (rule !== 'source-alpha' || fragment.imageAlpha > 0))
      if (covered && (rule !== 'source-alpha' || sourceAlphaByte(fragment.sourceAlpha) > 0)) return id
      continue
    }
    if (p.absent || p.shape === 8 || d <= 0 || fill[3] <= 0) continue
    const [cx, cy] = center(p, settings); const core = Math.max(d, 1)
    const dx = (x - cx) * 2 / core; const dy = (y - cy) * 2 / core
    const sprite = spriteDiameter(p, settings)
    if (Math.abs(x - cx) > sprite * 0.5 || Math.abs(y - cy) > sprite * 0.5) continue
    const distance = shapeDistance(dx, dy, p.shape)
    if (!(distance <= 0)) continue
    if (rule === 'source-alpha') {
      // Independent scalar coverage with f32 uploaded alpha/opacity and source
      // multiplication. It never samples the GPU's color or ID images.
      const f = Math.fround; const ramp = clamp(distance * core * 0.5 + 0.5, 0, 1)
      const coverage = f(1 - ramp * ramp * (3 - 2 * ramp))
      const smallAlpha = f(Math.min(1, f(d * d) / f(core * core)))
      const alpha = f(f(coverage * f(smallAlpha * f(fill[3]))) * f(bodyOpacity(p, settings)))
      if (sourceAlphaByte(alpha) === 0) continue
    }
    return id
  }
  return null
}

// Conservative broad phase only: the scalar picker remains the final oracle.
// A one-pixel margin keeps normalization/edge ties inside the tested region.
export function prepareReferencePick (points: Point[], settings: Settings, rule: PickingRule = 'visible'):
(x: number, y: number) => number | null {
  const entries = pointOrder(points, settings).reverse().flatMap(id => {
    const p = points[id]
    if (p.absent) return []
    const imageD = validImage(p, settings) ? diameter({ ...p, size: p.imageSize ?? p.size }, settings) : 0
    const radius = spriteDiameter(p, settings, imageD) * 0.5 + 1; const [cx, cy] = center(p, settings)
    return [{ id, point: [p], left: cx - radius, right: cx + radius, top: cy - radius, bottom: cy + radius }]
  })
  return (x, y): number | null => {
    for (const e of entries) {
      if (x < e.left || x > e.right || y < e.top || y > e.bottom) continue
      if (referencePick(e.point, settings, x, y, rule) !== null) return e.id
    }
    return null
  }
}
// RGBA8 comparison budget declared before evaluation: two channel levels account
// for quantization/blend evaluation. IDs and visibility checks have no tolerance.
export const COLOR_BUDGET = 2
export type ColorComparison = { changedPixels: number; maxChannelError: number; budgetFailures: number;
  firstBudgetMismatch?: { x: number; y: number; left: number[]; right: number[] }; }
export function compareColors (a: Snapshot, b: Snapshot): ColorComparison {
  if (a.width !== b.width || a.height !== b.height || a.color.length !== a.width * a.height * 4 || b.color.length !== a.color.length) {
    throw new Error('Mismatched color framebuffer dimensions')
  }
  const result: ColorComparison = { changedPixels: 0, maxChannelError: 0, budgetFailures: 0 }
  for (let offset = 0; offset < a.color.length; offset += 4) {
    let difference = 0
    for (let c = 0; c < 4; c++) difference = Math.max(difference, Math.abs(a.color[offset + c] - b.color[offset + c]))
    if (difference > 0) result.changedPixels++
    if (difference > COLOR_BUDGET) {
      result.budgetFailures++
      result.firstBudgetMismatch ??= {
        x: (offset / 4) % a.width,
        y: Math.floor(offset / 4 / a.width),
        left: Array.from(a.color.subarray(offset, offset + 4)),
        right: Array.from(b.color.subarray(offset, offset + 4)),
      }
    }
    result.maxChannelError = Math.max(result.maxChannelError, difference)
  }
  return result
}

// Independent scalar texture/shape composition. Preserve production's RGB mix
// and max(shapeAlpha, imageAlpha), including its image-only alpha attenuation.
// Fixtures have no strokes; this is not a CPU renderer for all Cosmos features.
export function atlasCpuColors (snapshot: Snapshot, points: Point[], settings: Settings): ColorComparison {
  settings = {
    ...settings,
    atlasIsolation: snapshot.atlasIsolation ?? settings.atlasIsolation ?? 'original',
    atlasPacking: snapshot.atlasPacking ?? settings.atlasPacking ?? 'baseline',
    atlasSource: snapshot.atlasSource,
  }
  const { width, height } = snapshot; const color = new Uint8Array(width * height * 4)
  const order = pointOrder(points, settings)
  for (const id of order) {
    const p = resolvePoint(points[id], settings)
    if (p.stroke > 0) throw new Error('CPU atlas color fixtures must not have strokes')
    const d = diameter(p, settings)
    const imageD = p.image !== undefined ? diameter({ ...p, size: p.imageSize ?? p.size }, settings) : 0
    const sprite = Math.max(d, 1, imageD); const [cx, cy] = center(p, settings)
    const left = Math.max(0, Math.ceil(cx - sprite / 2 - 0.5)); const right = Math.min(width - 1, Math.floor(cx + sprite / 2 - 0.5))
    const top = Math.max(0, Math.ceil(cy - sprite / 2 - 0.5)); const bottom = Math.min(height - 1, Math.floor(cy + sprite / 2 - 0.5))
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const fragment = imageFragment(p, settings, x + 0.5, y + 0.5)
        if (!fragment) continue
        const a = clamp(fragment.sourceAlpha, 0, 1); const offset = (y * width + x) * 4
        for (let c = 0; c < 3; c++) color[offset + c] = Math.round(clamp(fragment.color[c] * a + color[offset + c] / 255 * (1 - a), 0, 1) * 255)
        color[offset + 3] = Math.round((a + color[offset + 3] / 255 * (1 - a)) * 255)
      }
    }
  }
  return compareColors(snapshot, { ...snapshot, color })
}
type MaskMismatch = {
  x: number; y: number; webgl: number | null; webgpu: number | null; expected: { webgl: number | null; webgpu: number | null };
}
type InvisiblePick = { x: number; y: number; point: number }
export type Comparison = {
  pixels: number; idDisagreements: number; webglReferenceFailures: number; webgpuReferenceFailures: number;
  colorFailures: number; maxChannelError: number; webglInvisiblePicks: number; webgpuInvisiblePicks: number;
  pickingRules: { webgl: PickingRule; webgpu: PickingRule };
  webglPickedPixels: number; webgpuPickedPixels: number; webglPaintedPixels: number; webgpuPaintedPixels: number;
  firstWebglInvisiblePick?: InvisiblePick; firstWebgpuInvisiblePick?: InvisiblePick;
  firstIdMismatch?: MaskMismatch;
  firstReferenceMismatch?: MaskMismatch;
  firstColorMismatch?: { x: number; y: number; webgl: number[]; webgpu: number[] };
  valid: boolean;
}

function * compareRows (gl: Snapshot, gpu: Snapshot, points: Point[], settings: Settings): Generator<void, Comparison> {
  if (gl.width !== gpu.width || gl.height !== gpu.height) throw new Error('Mismatched framebuffer dimensions')
  const result = {
    pickingRules: { webgl: gl.pickingRule ?? 'visible', webgpu: gpu.pickingRule ?? 'visible' },
    pixels: gl.width * gl.height,
    idDisagreements: 0,
    webglReferenceFailures: 0,
    webgpuReferenceFailures: 0,
    colorFailures: 0,
    maxChannelError: 0,
    webglInvisiblePicks: 0,
    webgpuInvisiblePicks: 0,
    webglPickedPixels: 0,
    webgpuPickedPixels: 0,
    webglPaintedPixels: 0,
    webgpuPaintedPixels: 0,
    firstWebglInvisiblePick: undefined as InvisiblePick | undefined,
    firstWebgpuInvisiblePick: undefined as InvisiblePick | undefined,
    firstIdMismatch: undefined as MaskMismatch | undefined,
    firstReferenceMismatch: undefined as MaskMismatch | undefined,
    firstColorMismatch: undefined as { x: number; y: number; webgl: number[]; webgpu: number[] } | undefined,
    valid: false,
  }
  const glSettings = {
    ...settings,
    atlasIsolation: gl.atlasIsolation ?? settings.atlasIsolation ?? 'original',
    atlasPacking: gl.atlasPacking ?? settings.atlasPacking ?? 'baseline',
    atlasSource: gl.atlasSource,
  }
  const gpuSettings = {
    ...settings,
    atlasIsolation: gpu.atlasIsolation ?? settings.atlasIsolation ?? 'original',
    atlasPacking: gpu.atlasPacking ?? settings.atlasPacking ?? 'baseline',
    atlasSource: gpu.atlasSource,
  }
  const referenceGl = prepareReferencePick(points, glSettings, result.pickingRules.webgl)
  const referenceGpu = prepareReferencePick(points, gpuSettings, result.pickingRules.webgpu)
  for (let y = 0; y < gl.height; y++) {
    for (let x = 0; x < gl.width; x++) {
      const offset = (y * gl.width + x) * 4
      const a = pick(gl, x, y); const b = pick(gpu, x, y)
      const expectedGl = referenceGl(x + 0.5, y + 0.5)
      const expectedGpu = result.pickingRules.webgl === result.pickingRules.webgpu && glSettings.atlasIsolation === gpuSettings.atlasIsolation &&
        glSettings.atlasPacking === gpuSettings.atlasPacking && glSettings.atlasSource === gpuSettings.atlasSource
        ? expectedGl
        : referenceGpu(x + 0.5, y + 0.5)
      if (a !== b) {
        result.idDisagreements++; result.firstIdMismatch ??= { x, y, webgl: a, webgpu: b, expected: { webgl: expectedGl, webgpu: expectedGpu } }
      }
      if (a !== expectedGl) result.webglReferenceFailures++
      if (b !== expectedGpu) result.webgpuReferenceFailures++
      if (a !== expectedGl || b !== expectedGpu) {
        result.firstReferenceMismatch ??= { x, y, webgl: a, webgpu: b, expected: { webgl: expectedGl, webgpu: expectedGpu } }
      }
      if (a !== null) result.webglPickedPixels++
      if (b !== null) result.webgpuPickedPixels++
      if (gl.color[offset + 3] > 0) result.webglPaintedPixels++
      if (gpu.color[offset + 3] > 0) result.webgpuPaintedPixels++
      if (a !== null && gl.color[offset + 3] === 0) {
        result.webglInvisiblePicks++; result.firstWebglInvisiblePick ??= { x, y, point: a }
      }
      if (b !== null && gpu.color[offset + 3] === 0) {
        result.webgpuInvisiblePicks++; result.firstWebgpuInvisiblePick ??= { x, y, point: b }
      }
      let maximum = 0
      for (let c = 0; c < 4; c++) maximum = Math.max(maximum, Math.abs(gl.color[offset + c] - gpu.color[offset + c]))
      result.maxChannelError = Math.max(result.maxChannelError, maximum)
      if (maximum > COLOR_BUDGET) {
        result.colorFailures++
        result.firstColorMismatch ??= {
          x, y, webgl: Array.from(gl.color.subarray(offset, offset + 4)), webgpu: Array.from(gpu.color.subarray(offset, offset + 4)),
        }
      }
    }
    if ((y + 1) % 16 === 0) yield
  }
  result.valid = result.idDisagreements === 0 && result.webglReferenceFailures === 0 && result.webgpuReferenceFailures === 0 &&
    result.colorFailures === 0 && result.webglInvisiblePicks === 0 && result.webgpuInvisiblePicks === 0
  return result
}

export function compareSnapshots (gl: Snapshot, gpu: Snapshot, points: Point[], settings: Settings): Comparison {
  const rows = compareRows(gl, gpu, points, settings)
  let step = rows.next()
  while (!step.done) step = rows.next()
  return step.value
}

// Sweeps use the identical pixel audit in small chunks so input and paint are
// serviced during CPU reference evaluation. Cancellation still retains full rows.
export async function compareSnapshotsAsync (gl: Snapshot, gpu: Snapshot, points: Point[], settings: Settings): Promise<Comparison> {
  const rows = compareRows(gl, gpu, points, settings)
  let step = rows.next()
  while (!step.done) {
    await new Promise<void>(resolve => { setTimeout(resolve, 0) })
    step = rows.next()
  }
  return step.value
}

type RegionCounts = Pick<Comparison, 'pixels' | 'idDisagreements' | 'webglReferenceFailures' | 'webgpuReferenceFailures' | 'colorFailures'>
export type PracticalBoundary = {
  valid: boolean; boundary: RegionCounts; outside: RegionCounts; wrongObjectPixels: number;
  webglInvisiblePicks: number; webgpuInvisiblePicks: number; thinPointIds: number[]; vanishedPointIds: number[];
}

// The three shape fixtures contain bodies and inset strokes. Only their outer
// contours get the one-device-pixel allowance. Reuse the full-frame audit so
// background, interior pixels and invisible picks keep their original checks.
export function evaluatePracticalBoundary (gl: Snapshot, gpu: Snapshot, points: Point[], settings: Settings, strict: Comparison): PracticalBoundary {
  const bodies = points.map((point, id) => {
    const p = resolvePoint(point, settings)
    const d = diameter(p, settings)
    if (p.absent || p.shape === 8 || d <= 0 || p.color[3] <= 0 || settings.opacity <= 0) return null
    const [cx, cy] = center(p, settings)
    const radius = Math.max(d, 1) / 2
    const distance = (x: number, y: number): number => shapeDistance((x - cx) / radius, (y - cy) / radius, p.shape) * radius
    const canPaint = (x: number, y: number): boolean => Math.abs(x - cx) <= radius && Math.abs(y - cy) <= radius && distance(x, y) < 0.5
    return { id, cx, cy, d, radius, distance, canPaint }
  })
  const band = new Set<number>()
  const thinPointIds: number[] = []
  const vanishedPointIds: number[] = []
  for (const body of bodies) {
    if (!body) continue
    const { id, cx, cy, d, radius, distance } = body
    const left = Math.max(0, Math.ceil(cx - radius - 1.5)); const right = Math.min(gl.width - 1, Math.floor(cx + radius + 0.5))
    const top = Math.max(0, Math.ceil(cy - radius - 1.5)); const bottom = Math.min(gl.height - 1, Math.floor(cy + radius + 0.5))
    // A body at most two device pixels wide can fit entirely inside its edge band.
    const thin = d <= 2 && cx + radius > 0 && cy + radius > 0 && cx - radius < gl.width && cy - radius < gl.height
    let painted = false
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const px = x + 0.5; const py = y + 0.5; const index = y * gl.width + x
        if (Math.abs(distance(px, py)) <= 1) band.add(index)
        // Count actual alpha, including antialiasing outside the picking mask.
        // Paint from a neighboring point cannot establish this point's visibility.
        if (thin && !painted && gpu.color[index * 4 + 3] > 0 && body.canPaint(px, py)) {
          painted = !bodies.some(other => other && other.id !== id && other.canPaint(px, py))
        }
      }
    }
    if (thin) {
      thinPointIds.push(id)
      if (!painted) vanishedPointIds.push(id)
    }
  }
  const boundary = { pixels: band.size, idDisagreements: 0, webglReferenceFailures: 0, webgpuReferenceFailures: 0, colorFailures: 0 }
  const expectedGl = prepareReferencePick(points, settings, strict.pickingRules.webgl)
  const expectedGpu = strict.pickingRules.webgpu === strict.pickingRules.webgl ? expectedGl : prepareReferencePick(points, settings, strict.pickingRules.webgpu)
  let wrongObjectPixels = 0
  for (const index of band) {
    const x = index % gl.width; const y = Math.floor(index / gl.width)
    const a = pick(gl, x, y); const b = pick(gpu, x, y)
    const refA = expectedGl(x + 0.5, y + 0.5); const refB = expectedGpu(x + 0.5, y + 0.5)
    if (a !== b) boundary.idDisagreements++
    if (a !== refA) boundary.webglReferenceFailures++
    if (b !== refB) boundary.webgpuReferenceFailures++
    const atOwnEdge = (id: number | null): boolean => id === null || Math.abs(bodies[id]?.distance(x + 0.5, y + 0.5) ?? Infinity) <= 1
    if ((a !== refA && !(atOwnEdge(a) && atOwnEdge(refA))) || (b !== refB && !(atOwnEdge(b) && atOwnEdge(refB)))) wrongObjectPixels++
    const offset = index * 4
    for (let c = 0; c < 4; c++) {
      if (Math.abs(gl.color[offset + c] - gpu.color[offset + c]) > COLOR_BUDGET) { boundary.colorFailures++; break }
    }
  }
  const outside = {
    pixels: strict.pixels - boundary.pixels,
    idDisagreements: strict.idDisagreements - boundary.idDisagreements,
    webglReferenceFailures: strict.webglReferenceFailures - boundary.webglReferenceFailures,
    webgpuReferenceFailures: strict.webgpuReferenceFailures - boundary.webgpuReferenceFailures,
    colorFailures: strict.colorFailures - boundary.colorFailures,
  }
  const { webglInvisiblePicks, webgpuInvisiblePicks } = strict
  const valid = outside.idDisagreements === 0 && outside.webglReferenceFailures === 0 && outside.webgpuReferenceFailures === 0 &&
    outside.colorFailures === 0 && webglInvisiblePicks === 0 && webgpuInvisiblePicks === 0 && wrongObjectPixels === 0 && vanishedPointIds.length === 0
  return { valid, boundary, outside, wrongObjectPixels, webglInvisiblePicks, webgpuInvisiblePicks, thinPointIds, vanishedPointIds }
}
