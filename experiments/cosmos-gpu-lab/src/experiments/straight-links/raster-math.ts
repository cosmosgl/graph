// Exact signs over the finite binary values supplied to this diagnostic. These
// predicates NEVER replace the experiment's existing scalar masks or colors.
export type Vec = [number, number]
function integers (values: number[]): bigint[] {
  const view = new DataView(new ArrayBuffer(8))
  const terms = values.map(value => {
    if (!Number.isFinite(value)) throw new Error('Raster diagnostics require finite coordinates')
    view.setFloat64(0, value); const bits = view.getBigUint64(0); const exponent = Number((bits >> 52n) & 2047n)
    const sign = bits >> 63n ? -1n : 1n
    return { n: sign * ((bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n)), e: (exponent || 1) - 1023 - 52 }
  })
  const exponent = Math.min(...terms.filter(t => t.n !== 0n).map(t => t.e), 0)
  return terms.map(t => t.n === 0n ? 0n : t.n << BigInt(t.e - exponent))
}
function sign (n: bigint): number { return n === 0n ? 0 : n > 0n ? 1 : -1 }
export function exactCaps (a: Vec, b: Vec, p: Vec): { start: number; end: number; halfOpen: boolean } {
  const [ax, ay, bx, by, px, py] = integers([...a, ...b, ...p]); const dx = bx - ax; const dy = by - ay
  const start = sign((px - ax) * dx + (py - ay) * dy); const end = sign((bx - px) * dx + (by - py) * dy)
  const startInclusive = dx > 0n || (dx === 0n && dy > 0n)
  return { start, end, halfOpen: (start > 0 || (start === 0 && startInclusive)) && (end > 0 || (end === 0 && !startInclusive)) }
}
function exactTriangle (a: Vec, b: Vec, c: Vec, p: Vec): boolean {
  const v = integers([...a, ...b, ...c, ...p]); const points = [[v[0], v[1]], [v[2], v[3]], [v[4], v[5]]]
  const cross = (a: bigint[], b: bigint[], p: bigint[]): bigint => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
  const area = cross(points[0], points[1], points[2]); if (area === 0n) return false
  if (area < 0n) [points[1], points[2]] = [points[2], points[1]]
  return points.every((a, i) => {
    const b = points[(i + 1) % 3]; const edge = cross(a, b, [v[6], v[7]]); const dx = b[0] - a[0]; const dy = b[1] - a[1]
    return edge > 0n || (edge === 0n && (dy < 0n || (dy === 0n && dx > 0n)))
  })
}
export function exactQuad (v: Vec[], p: Vec): boolean {
  if (v.length !== 4) throw new Error('Four ribbon corners are required')
  return exactTriangle(v[0], v[1], v[2], p) || exactTriangle(v[2], v[1], v[3], p)
}
export function capturedQuad (data: Float32Array | undefined, link: number, width: number, height: number): { clip: Vec[]; screen: Vec[] } {
  if (!data) throw new Error('Vertex capture is required')
  const clip: Vec[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 2] === link + 1) clip[data[i + 3] - 1] = [data[i], data[i + 1]]
  }
  if (clip.filter(Boolean).length !== 4) throw new Error('Missing captured ribbon corner')
  return { clip, screen: clip.map(([x, y]) => [(x + 1) * width * 0.5, (1 - y) * height * 0.5]) }
}
