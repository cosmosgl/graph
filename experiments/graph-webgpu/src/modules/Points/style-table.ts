export const pointStride = 24
const idLane = 18

/** Dense buffers contain one Point per ID. Compact buffers start with a shared Point,
 * followed by exceptions in ascending ID order. The image grey level is identical
 * in every record; its word in an exception stores the uint32 ID instead. */
export interface PointStyleTable { attributes: Float32Array; ids?: Uint32Array }

export function packPointStyles (
  count: number, limit: number, tryShared: boolean, write: (id: number, target: Float32Array, offset: number, dense: boolean) => void
): PointStyleTable {
  const recordBytes = pointStride * Float32Array.BYTES_PER_ELEMENT
  const denseFits = count * recordBytes <= limit
  const dense = (): PointStyleTable => {
    const attributes = new Float32Array(count * pointStride)
    for (let i = 0; i < count; i++) write(i, attributes, i * pointStride, true)
    return { attributes }
  }
  if (!count || (!tryShared && denseFits)) return dense()
  const record = (id: number): Float32Array => {
    const values = new Float32Array(pointStride)
    write(id, values, 0, false)
    return values
  }
  const same = (a: Float32Array, b: Float32Array): boolean => {
    for (let i = 0; i < pointStride; i++) if (!Object.is(a[i], b[i])) return false
    return true
  }
  const first = record(0)
  const shared = same(first, record(count - 1)) ? first : record(count >>> 1)
  const scratch = new Float32Array(pointStride)
  const exceptions: number[] = []
  const maxExceptions = denseFits ? Math.floor(count / 4) : Math.floor(limit / recordBytes) - 1
  const collect = (): boolean => {
    exceptions.length = 0
    for (let i = 0; i < count; i++) {
      write(i, scratch, 0, false)
      if (same(shared, scratch)) continue
      if (exceptions.length >= maxExceptions) return false
      exceptions.push(i)
    }
    return true
  }
  if (!collect()) {
    // The first point can itself be exceptional. Boyer–Moore finds any
    // strictly predominant record without retaining all distinct records.
    // Only a failed initial guess pays for this pass; collect verifies it.
    let votes = 0
    for (let i = 0; i < count; i++) {
      write(i, scratch, 0, false)
      if (!votes) shared.set(scratch)
      votes += same(shared, scratch) ? 1 : -1
    }
    if (!collect()) {
      if (denseFits) return dense()
      throw new Error(`The point style overrides exceed this device's ${limit}-byte storage binding.`)
    }
  }
  const attributes = new Float32Array((1 + exceptions.length) * pointStride)
  const words = new Uint32Array(attributes.buffer)
  attributes.set(shared)
  for (const [slot, id] of exceptions.entries()) {
    const offset = (slot + 1) * pointStride
    write(id, attributes, offset, false)
    words[offset + idLane] = id
  }
  return { attributes, ids: Uint32Array.from(exceptions) }
}

/** Generate the same lookup for independently bound current/previous snapshots and the pick scan. */
export function readPointStyle (name: string, buffer: string): string {
  return `fn ${name}(id: u32, records: u32) -> Point {
    if (records == 0u) { return ${buffer}[id]; }
    let base = ${buffer}[0];
    var lo = 1u; var hi = records;
    while (lo < hi) {
      let mid = lo + (hi - lo) / 2u;
      let key = bitcast<u32>(${buffer}[mid].effects.z);
      if (key < id) { lo = mid + 1u; } else { hi = mid; }
    }
    if (lo < records && bitcast<u32>(${buffer}[lo].effects.z) == id) {
      var entry = ${buffer}[lo]; entry.effects.z = base.effects.z; return entry;
    }
    return base;
  }`
}

/** A new slot starts at its target style. If a count changes, retain exceptions
 * for the smaller side of that boundary as well as exceptions from either input. */
export function interruptedPointTable (
  previous: Uint32Array | undefined, next: Uint32Array | undefined, fromCount: number, toCount: number, limit: number
): { ids?: Uint32Array; mixShared: boolean } {
  const denseFits = toCount * pointStride * 4 <= limit
  if (!next || (!previous && denseFits)) return { mixShared: false }
  const oldSlots = Math.min(fromCount, toCount)
  const mixShared = !!previous && oldSlots >= toCount - oldSlots
  const exceptions = new Set<number>(next)
  if (previous) for (const id of previous) if (id < oldSlots) exceptions.add(id)
  const start = mixShared ? oldSlots : 0
  const end = mixShared ? toCount : oldSlots
  for (let i = start; i < end; i++) exceptions.add(i)
  if (denseFits && exceptions.size + 1 >= toCount) return { mixShared: false }
  if ((exceptions.size + 1) * pointStride * 4 > limit) throw new Error(`The interrupted point styles exceed this device's ${limit}-byte storage binding.`)
  return { ids: Uint32Array.from(exceptions).sort(), mixShared }
}
