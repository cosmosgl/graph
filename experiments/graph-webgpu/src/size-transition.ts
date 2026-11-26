export type SizeValues = number | Float32Array

function valueAt (values: SizeValues, index: number): number {
  return typeof values === 'number' ? values : values[index]!
}

/** Keep uniform sizes as one number. Copy varying sizes so callers can reuse their input arrays. */
export function captureSizes (count: number, read: (index: number) => number): SizeValues {
  if (!count) return 0
  const first = Math.fround(read(0))
  let values: Float32Array | undefined
  for (let i = 1; i < count; i++) {
    const value = Math.fround(read(i))
    if (!values && value !== first) {
      values = new Float32Array(count)
      values.fill(first, 0, i)
    }
    if (values) values[i] = value
  }
  return values ?? first
}

/** Mirrors the size or width in the drawn record. New slots use their target from the first frame. */
export function displayedSize (index: number, progress: number, target: SizeValues, source?: SizeValues, sourceCount = 0): number {
  const to = valueAt(target, index)
  if (source === undefined || index >= sourceCount || progress >= 1) return to
  const from = valueAt(source, index)
  return from + (to - from) * progress
}
