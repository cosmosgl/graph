import { cellOf, layout, type Frame } from './data'
import { replaceOnce } from './trace'

// Stable counting order for the diagnostic's fixed input. This CPU preparation
// is outside the GPU timer and is not a replacement for a resident GPU index.
export function orderTargetsByCell (points: Float32Array, frame: Frame): Uint32Array {
  const count = points.length / 4
  if (!Number.isInteger(count)) throw new Error('Expected point vec4s')
  const n = layout(count).finest; const cells = n * n
  const keys = new Uint32Array(count); const offsets = new Uint32Array(cells + 2)
  for (let i = 0; i < count; i++) {
    const j = i * 4
    const key = points[j + 3] > 0.5 ? cells : cellOf(points[j], points[j + 1], n, frame.bounds)
    keys[i] = key; offsets[key + 1]++
  }
  for (let i = 1; i < offsets.length; i++) offsets[i] += offsets[i - 1]
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i++) order[offsets[keys[i]]++] = i
  return order
}

// Remap only the dispatch order; all buffers and force outputs still use the
// original point index. No point's contribution ordering is changed.
export function spatialOrderShader (shader: string): string {
  return `${replaceOnce(shader,
    'let targetIndex = gid.x; if (targetIndex >= u32(params.count)) { return; }',
    'let dispatchIndex = gid.x; if (dispatchIndex >= u32(params.count)) { return; } let targetIndex = targetOrder[dispatchIndex];')
  }\n@group(0) @binding(12) var<storage, read> targetOrder: array<u32>;\n`
}
