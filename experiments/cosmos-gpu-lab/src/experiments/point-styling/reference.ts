import { pick, type PickingRule, type Snapshot } from './backend'
import { center, diameter, resolvePoint, type Point, type Settings } from './data'
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
export function referencePick (points: Point[], settings: Settings, x: number, y: number, rule: PickingRule = 'visible'): number | null {
  // Candidate visibility is explicit. Retain the original opacity-independent
  // geometry reference for the production control; neither rule reads GPU pixels.
  if (rule === 'visible' && settings.opacity <= 0) return null
  const order = points.map((_, id) => id); if (!settings.reverse) order.reverse()
  for (const id of order) {
    const p = resolvePoint(points[id], settings); const d = diameter(p, settings)
    if (p.absent || p.shape === 8 || d <= 0 || p.color[3] <= 0) continue
    const [cx, cy] = center(p, settings); const core = Math.max(d, 1)
    const dx = (x - cx) * 2 / core; const dy = (y - cy) * 2 / core
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && shapeDistance(dx, dy, p.shape) <= 0) return id
  }
  return null
}
// RGBA8 comparison budget declared before evaluation: two channel levels account
// for quantization/blend evaluation. IDs and visibility checks have no tolerance.
export const COLOR_BUDGET = 2
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
  for (let y = 0; y < gl.height; y++) {
    for (let x = 0; x < gl.width; x++) {
      const offset = (y * gl.width + x) * 4
      const a = pick(gl, x, y); const b = pick(gpu, x, y)
      const expectedGl = referencePick(points, settings, x + 0.5, y + 0.5, result.pickingRules.webgl)
      const expectedGpu = result.pickingRules.webgl === result.pickingRules.webgpu
        ? expectedGl
        : referencePick(points, settings, x + 0.5, y + 0.5, result.pickingRules.webgpu)
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
