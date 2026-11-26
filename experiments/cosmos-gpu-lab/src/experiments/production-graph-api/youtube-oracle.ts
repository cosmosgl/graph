import type { Pair } from '../selection/reference'

type SelectionMismatch = { id: number; x: number; y: number; expected: boolean }
type LabelMismatch = { id: number; expected: Pair; actual: Pair | null }
export type ReleaseOracle = {
  expected: number;
  expectedIdsSha256: string;
  selectedIdsSha256: string | null;
  trackedPositionsSha256: string | null;
  missing: number | null;
  extra: number | null;
  wrongLabels: number | null;
  unexpectedLabelIds: number[] | null;
  wrongLabelExamples: LabelMismatch[];
  examples: SelectionMismatch[];
}

export async function arrayHash (array: Float32Array | Uint32Array): Promise<string> {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice())
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

// Index the edges by pixel row so a million-point oracle can check the complete
// path without scanning hundreds of edges per point. The fixture radius is 1 CSS px.
function lassoTouches (vertices: Pair[]): (x: number, y: number) => boolean {
  const rows = new Map<number, Array<[Pair, Pair]>>()
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    for (let row = Math.floor(Math.min(a[1], b[1]) - 1); row <= Math.floor(Math.max(a[1], b[1]) + 1); row++) {
      const edges = rows.get(row) ?? []
      edges.push([a, b])
      rows.set(row, edges)
    }
  }
  return (x, y) => {
    let inside = false
    for (const [a, b] of rows.get(Math.floor(y)) ?? []) {
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      if ((a[1] > y) !== (b[1] > y) && x < a[0] + dx * (y - a[1]) / dy) inside = !inside
      const length2 = dx * dx + dy * dy
      const t = length2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length2)) : 0
      if ((x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2 <= 1) return true
    }
    return inside
  }
}

/** Compare each real package with its own independently evolving layout at pointer release. */
export async function verifyRelease (
  xy: Float32Array, count: number, origin: number, center: Pair, zoom: number, rect: [Pair, Pair],
  selected: number[] | null, tracked: number[], positions: ReadonlyMap<number, Pair> | null, polygon?: Pair[]
): Promise<ReleaseOracle> {
  if (xy.length !== 2 * count) throw new Error(`Expected ${2 * count} release coordinates, read ${xy.length}`)
  const [[left, top], [right, bottom]] = rect
  const touches = polygon
    ? lassoTouches(polygon)
    : (x: number, y: number): boolean => {
      const dx = Math.max(left - x, 0, x - right)
      const dy = Math.max(top - y, 0, y - bottom)
      return dx * dx + dy * dy <= 1
    }
  const expected: number[] = []
  const selectedSet = new Set(selected)
  const examples: SelectionMismatch[] = []
  let missing = 0
  let extra = 0
  for (let id = 0; id < count; id++) {
    const x = center[0] + (xy[2 * id] - origin) * zoom
    const y = center[1] - (xy[2 * id + 1] - origin) * zoom
    // Both packages draw a two-CSS-pixel point with a fixed radius when zoomed out.
    const inside = touches(x, y)
    if (inside) expected.push(id)
    if (selected && inside !== selectedSet.has(id)) {
      if (inside) missing++
      else extra++
      if (examples.length < 12) examples.push({ id, x, y, expected: inside })
    }
  }
  if (selected) extra += selected.filter(id => !Number.isInteger(id) || id < 0 || id >= count).length + selected.length - selectedSet.size

  const wanted = new Set(tracked)
  const unexpectedLabelIds = positions ? [...positions.keys()].filter(id => !wanted.has(id)) : null
  const wrongLabelExamples: LabelMismatch[] = []
  let wrongLabels = 0
  let trackedPositionsSha256: string | null = null
  if (positions) {
    // A map's insertion order can vary between engines. Hash the actual XY
    // pairs by ascending tracked ID so the complete reply can be compared.
    const coordinates = new Float32Array(tracked.length * 2)
    const orderedIds = [...tracked].sort((a, b) => a - b)
    let returned = 0
    for (const id of orderedIds) {
      const actual = positions.get(id)
      if (actual) {
        coordinates.set(actual, returned * 2)
        returned++
      }
      if (actual?.[0] !== xy[2 * id] || actual?.[1] !== xy[2 * id + 1]) {
        wrongLabels++
        if (wrongLabelExamples.length < 12) wrongLabelExamples.push({ id, expected: [xy[2 * id], xy[2 * id + 1]], actual: actual ?? null })
      }
    }
    wrongLabels += unexpectedLabelIds!.length
    if (returned === tracked.length && unexpectedLabelIds!.length === 0) trackedPositionsSha256 = await arrayHash(coordinates)
  }
  return {
    expected: expected.length,
    expectedIdsSha256: await arrayHash(Uint32Array.from(expected)),
    selectedIdsSha256: selected ? await arrayHash(Uint32Array.from(selected)) : null,
    trackedPositionsSha256,
    missing: selected ? missing : null,
    extra: selected ? extra : null,
    wrongLabels: positions ? wrongLabels : null,
    unexpectedLabelIds: unexpectedLabelIds?.slice(0, 12) ?? null,
    wrongLabelExamples,
    examples,
  }
}
