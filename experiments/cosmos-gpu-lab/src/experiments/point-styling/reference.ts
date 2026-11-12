import { pick, type Snapshot } from './backend'
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
export function referencePick (points: Point[], settings: Settings, x: number, y: number): number | null {
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
export function compareSnapshots (gl: Snapshot, gpu: Snapshot, points: Point[], settings: Settings): {
  pixels: number; idDisagreements: number; webglReferenceFailures: number; webgpuReferenceFailures: number;
  colorFailures: number; maxChannelError: number; webglInvisiblePicks: number; webgpuInvisiblePicks: number;
  firstIdMismatch?: { x: number; y: number; webgl: number | null; webgpu: number | null; reference: number | null };
  firstReferenceMismatch?: { x: number; y: number; webgl: number | null; webgpu: number | null; reference: number | null };
  firstColorMismatch?: { x: number; y: number; webgl: number[]; webgpu: number[] };
  valid: boolean;
} {
  if (gl.width !== gpu.width || gl.height !== gpu.height) throw new Error('Mismatched framebuffer dimensions')
  const result = {
    pixels: gl.width * gl.height,
    idDisagreements: 0,
    webglReferenceFailures: 0,
    webgpuReferenceFailures: 0,
    colorFailures: 0,
    maxChannelError: 0,
    webglInvisiblePicks: 0,
    webgpuInvisiblePicks: 0,
    firstIdMismatch: undefined as { x: number; y: number; webgl: number | null; webgpu: number | null; reference: number | null } | undefined,
    firstReferenceMismatch: undefined as { x: number; y: number; webgl: number | null; webgpu: number | null; reference: number | null } | undefined,
    firstColorMismatch: undefined as { x: number; y: number; webgl: number[]; webgpu: number[] } | undefined,
    valid: false,
  }
  for (let y = 0; y < gl.height; y++) {
    for (let x = 0; x < gl.width; x++) {
      const offset = (y * gl.width + x) * 4
      const a = pick(gl, x, y); const b = pick(gpu, x, y); const expected = referencePick(points, settings, x + 0.5, y + 0.5)
      if (a !== b) { result.idDisagreements++; result.firstIdMismatch ??= { x, y, webgl: a, webgpu: b, reference: expected } }
      if (a !== expected) result.webglReferenceFailures++
      if (b !== expected) result.webgpuReferenceFailures++
      if (a !== expected || b !== expected) result.firstReferenceMismatch ??= { x, y, webgl: a, webgpu: b, reference: expected }
      if (a !== null && gl.color[offset + 3] === 0) result.webglInvisiblePicks++
      if (b !== null && gpu.color[offset + 3] === 0) result.webgpuInvisiblePicks++
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
  }
  result.valid = result.idDisagreements === 0 && result.webglReferenceFailures === 0 && result.webgpuReferenceFailures === 0 &&
    result.colorFailures === 0 && result.webglInvisiblePicks === 0 && result.webgpuInvisiblePicks === 0
  return result
}
