import { getFinestGridSize } from '../../../../../src/modules/Shared/cell-slots'
export type Frame = { bounds: Float32Array; seed: number; slots: number; precise: boolean }
export type Layout = { sizes: number[]; offsets: number[]; cells: number; finest: number }
export type Structure = { aggregates: Float32Array; slots: Float32Array }
export function layout (count: number): Layout {
  const finest = getFinestGridSize(count); const sizes: number[] = []; const offsets: number[] = []
  let cells = 0
  for (let n = 8; n <= finest; n *= 2) { sizes.push(n); offsets.push(cells); cells += n * n }
  return { finest, sizes, offsets, cells }
}
const f = Math.fround
export function frameSamples (tick: number): { jitter: [number, number]; seed: number } {
  let seed = (29471 + tick) >>> 0
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return f(seed / 4294967296) }
  return { jitter: [random(), random()], seed: random() }
}
export function frameFor (points: Float32Array, tick: number, slots = 8, precise = true): Frame {
  const samples = frameSamples(tick)
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (let i = 0; i < points.length; i += 4) {
    if (points[i + 3] > 0.5) continue
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i])
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1])
  }
  if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0
  const extent = Math.max(f(maxX - minX), f(maxY - minY), layout(points.length / 4).finest * 0.25)
  const cell = f(extent / 7)
  const x = f(f(f(minX + maxX) * 0.5) - f(extent * 0.5))
  const y = f(f(f(minY + maxY) * 0.5) - f(extent * 0.5))
  const span = f(extent + cell)
  const bounds = new Float32Array([f(x - f(samples.jitter[0] * cell)), f(y - f(samples.jitter[1] * cell)), span, f(1 / span)])
  return { bounds, seed: samples.seed, slots, precise }
}
export function cellOf (x: number, y: number, n: number, box: Float32Array): number {
  const scale = f(box[3] * n)
  const cx = Math.max(0, Math.min(n - 1, Math.floor(f(f(x - box[0]) * scale))))
  const cy = Math.max(0, Math.min(n - 1, Math.floor(f(f(y - box[1]) * scale))))
  return cy * n + cx
}
export function hash (index: number, seed: number): number {
  const bits = new Uint32Array(new Float32Array([seed]).buffer)[0]
  let h = (index ^ bits) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return f(f(0.001) + f(f(f((h >>> 8) + 0.5) / 16777216) * f(0.998)))
}
export function buildReference (points: Float32Array, frame: Frame): Structure {
  const l = layout(points.length / 4)
  const aggregates = new Float32Array(l.cells * 4)
  const members: number[][] = Array.from({ length: l.finest ** 2 }, () => [])
  const hashes = new Float32Array(points.length / 4)
  for (let i = 0; i < points.length / 4; i++) {
    if (points[i * 4 + 3] > 0.5) continue
    for (const [level, n] of l.sizes.entries()) {
      const c = cellOf(points[i * 4], points[i * 4 + 1], n, frame.bounds)
      const out = (l.offsets[level] + c) * 4
      aggregates[out] = f(aggregates[out] + points[i * 4]); aggregates[out + 1] = f(aggregates[out + 1] + points[i * 4 + 1]); aggregates[out + 2]++
      if (n === l.finest) members[c].push(i)
    }
    hashes[i] = hash(i, frame.seed)
  }
  const cells = l.finest ** 2; const slots = new Float32Array(cells * frame.slots * 2)
  for (let i = 0; i < slots.length; i += 2) { slots[i] = -1; slots[i + 1] = 1 }
  for (let c = 0; c < cells; c++) {
    members[c].sort((a, b) => hashes[a] - hashes[b] || a - b)
    let previous = -1; let slot = 0
    for (const i of members[c]) {
      if (hashes[i] <= previous) continue
      slots[(slot * cells + c) * 2] = i; slots[(slot * cells + c) * 2 + 1] = hashes[i]
      previous = hashes[i]; if (++slot === frame.slots) break
    }
  }
  return { aggregates, slots }
}
