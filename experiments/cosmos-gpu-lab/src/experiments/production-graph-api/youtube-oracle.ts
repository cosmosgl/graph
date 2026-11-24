import type { Pair } from '../selection/reference'

type SelectionMismatch = { id: number; x: number; y: number; expected: boolean; edgeDistance: number }
type LabelMismatch = { id: number; expected: Pair; actual: Pair | null }
export type ReleaseOracle = {
  expected: number;
  expectedIdsSha256: string;
  selectedIdsSha256: string | null;
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

/** Compare each real package with its own independently evolving layout at pointer release. */
export async function verifyRelease (
  xy: Float32Array, count: number, origin: number, center: Pair, zoom: number, rect: [Pair, Pair],
  selected: number[] | null, tracked: number[], positions: ReadonlyMap<number, Pair> | null
): Promise<ReleaseOracle> {
  if (xy.length !== 2 * count) throw new Error(`Expected ${2 * count} release coordinates, read ${xy.length}`)
  const [[left, top], [right, bottom]] = rect
  const expected: number[] = []
  const selectedSet = new Set(selected)
  const examples: SelectionMismatch[] = []
  let missing = 0
  let extra = 0
  for (let id = 0; id < count; id++) {
    const x = center[0] + (xy[2 * id] - origin) * zoom
    const y = center[1] - (xy[2 * id + 1] - origin) * zoom
    // Both packages draw a two-CSS-pixel point with a fixed radius when zoomed out.
    const edgeDistance = Math.min(x + 1 - left, right + 1 - x, y + 1 - top, bottom + 1 - y)
    const inside = edgeDistance >= 0
    if (inside) expected.push(id)
    if (selected && inside !== selectedSet.has(id)) {
      if (inside) missing++
      else extra++
      if (examples.length < 12) examples.push({ id, x, y, expected: inside, edgeDistance })
    }
  }
  if (selected) extra += selected.filter(id => !Number.isInteger(id) || id < 0 || id >= count).length + selected.length - selectedSet.size

  const wanted = new Set(tracked)
  const unexpectedLabelIds = positions ? [...positions.keys()].filter(id => !wanted.has(id)) : null
  const wrongLabelExamples: LabelMismatch[] = []
  let wrongLabels = 0
  if (positions) {
    for (const id of tracked) {
      const actual = positions.get(id)
      if (actual?.[0] !== xy[2 * id] || actual?.[1] !== xy[2 * id + 1]) {
        wrongLabels++
        if (wrongLabelExamples.length < 12) wrongLabelExamples.push({ id, expected: [xy[2 * id], xy[2 * id + 1]], actual: actual ?? null })
      }
    }
    wrongLabels += unexpectedLabelIds!.length
  }
  return {
    expected: expected.length,
    expectedIdsSha256: await arrayHash(Uint32Array.from(expected)),
    selectedIdsSha256: selected ? await arrayHash(Uint32Array.from(selected)) : null,
    missing: selected ? missing : null,
    extra: selected ? extra : null,
    wrongLabels: positions ? wrongLabels : null,
    unexpectedLabelIds: unexpectedLabelIds?.slice(0, 12) ?? null,
    wrongLabelExamples,
    examples,
  }
}
