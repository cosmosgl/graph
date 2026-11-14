import { pick, type PickingRule, type Snapshot } from './backend'
import { center, diameter, resolvePoint, type Point, type Settings } from './data'
import { sourceAlphaByte } from './source-alpha'
import { IMAGE_COUNT, sampleAtlasPolicy } from './atlas'
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
function imageFragment (p: Point, settings: Settings, x: number, y: number):
{ imageCovered: boolean; imageAlpha: number; shapeCovered: boolean; sourceAlpha: number; color: number[] } | null {
  if (p.absent) return null
  const d = diameter(p, settings); const hasImage = p.image !== undefined && p.image >= 0 && p.image < IMAGE_COUNT
  const imageD = hasImage ? diameter({ ...p, size: p.imageSize ?? p.size }, settings) : 0
  if (Math.max(d, imageD) <= 0) return null
  const sprite = Math.max(d, 1, imageD); const core = Math.max(d, 1); const [cx, cy] = center(p, settings)
  if (Math.abs(x - cx) > sprite / 2 || Math.abs(y - cy) > sprite / 2) return null
  const distance = p.shape === 8 || d <= 0 ? Infinity : shapeDistance((x - cx) * 2 / core, (y - cy) * 2 / core, p.shape) * core * 0.5
  const ramp = clamp(distance + 0.5, 0, 1); const coverage = 1 - ramp * ramp * (3 - 2 * ramp)
  const area = Math.min(1, d * d / (core * core)); const f = Math.fround
  const shapeAlpha = f(f(coverage) * f(f(area) * f(p.color[3])))
  const imageCovered = hasImage && imageD > 0 && Math.abs(x - cx) <= imageD / 2 && Math.abs(y - cy) <= imageD / 2
  const image = imageCovered
    ? sampleAtlasPolicy(p.image!, (x - cx) / imageD + 0.5, (y - cy) / imageD + 0.5,
      settings.imageFilter ?? 'nearest', settings.atlasIsolation ?? 'original')
    : [0, 0, 0, 0]
  const color = [0, 1, 2].map(c => (p.shape === 8 || d <= 0 ? 0 : p.color[c]) * (1 - image[3]) + image[c] * image[3])
  return {
    imageCovered,
    imageAlpha: image[3],
    shapeCovered: distance <= 0 && p.color[3] > 0,
    sourceAlpha: f(Math.max(shapeAlpha, f(image[3])) * f(settings.opacity)),
    color,
  }
}

export function referencePick (points: Point[], settings: Settings, x: number, y: number, rule: PickingRule = 'visible'): number | null {
  // Candidate visibility is explicit. Retain the original opacity-independent
  // geometry reference for the production control; neither rule reads GPU pixels.
  if (rule !== 'legacy' && settings.opacity <= 0) return null
  const order = points.map((_, id) => id); if (!settings.reverse) order.reverse()
  for (const id of order) {
    const p = resolvePoint(points[id], settings); const d = diameter(p, settings)
    if (p.image !== undefined && p.image >= 0 && p.image < IMAGE_COUNT) {
      const fragment = imageFragment(p, settings, x, y)
      if (!fragment) continue
      const covered = fragment.shapeCovered || (fragment.imageCovered && (rule !== 'source-alpha' || fragment.imageAlpha > 0))
      if (covered && (rule !== 'source-alpha' || sourceAlphaByte(fragment.sourceAlpha) > 0)) return id
      continue
    }
    if (p.absent || p.shape === 8 || d <= 0 || p.color[3] <= 0) continue
    const [cx, cy] = center(p, settings); const core = Math.max(d, 1)
    const dx = (x - cx) * 2 / core; const dy = (y - cy) * 2 / core
    if (!(Math.abs(dx) <= 1 && Math.abs(dy) <= 1)) continue
    const distance = shapeDistance(dx, dy, p.shape)
    if (!(distance <= 0)) continue
    if (rule === 'source-alpha') {
      // Independent scalar coverage with f32 uploaded alpha/opacity and source
      // multiplication. It never samples the GPU's color or ID images.
      const f = Math.fround; const ramp = clamp(distance * core * 0.5 + 0.5, 0, 1)
      const coverage = f(1 - ramp * ramp * (3 - 2 * ramp))
      const smallAlpha = f(Math.min(1, f(d * d) / f(core * core)))
      const alpha = f(f(coverage * f(smallAlpha * f(p.color[3]))) * f(settings.opacity))
      if (sourceAlphaByte(alpha) === 0) continue
    }
    return id
  }
  return null
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
  settings = { ...settings, atlasIsolation: snapshot.atlasIsolation ?? settings.atlasIsolation ?? 'original' }
  const { width, height } = snapshot; const color = new Uint8Array(width * height * 4)
  const order = points.map((_, i) => i); if (settings.reverse) order.reverse()
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
  const glSettings = { ...settings, atlasIsolation: gl.atlasIsolation ?? settings.atlasIsolation ?? 'original' }
  const gpuSettings = { ...settings, atlasIsolation: gpu.atlasIsolation ?? settings.atlasIsolation ?? 'original' }
  for (let y = 0; y < gl.height; y++) {
    for (let x = 0; x < gl.width; x++) {
      const offset = (y * gl.width + x) * 4
      const a = pick(gl, x, y); const b = pick(gpu, x, y)
      const expectedGl = referencePick(points, glSettings, x + 0.5, y + 0.5, result.pickingRules.webgl)
      const expectedGpu = result.pickingRules.webgl === result.pickingRules.webgpu && glSettings.atlasIsolation === gpuSettings.atlasIsolation
        ? expectedGl
        : referencePick(points, gpuSettings, x + 0.5, y + 0.5, result.pickingRules.webgpu)
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
