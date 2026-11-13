export type Shape = { present: number; center: [number, number]; radius: number; finite: boolean }
export function shape (points: Float32Array): Shape {
  let x = 0; let y = 0; let present = 0; let finite = true
  for (let i = 0; i < points.length; i += 4) {
    if (points[i + 3] > 0.5) continue
    present++; x += points[i]; y += points[i + 1]
    finite &&= Number.isFinite(points[i]) && Number.isFinite(points[i + 1])
  }
  const center: [number, number] = present ? [x / present, y / present] : [0, 0]
  let sum = 0
  for (let i = 0; i < points.length; i += 4) {
    if (points[i + 3] <= 0.5) sum += (points[i] - center[0]) ** 2 + (points[i + 1] - center[1]) ** 2
  }
  return { present, center, radius: present ? Math.sqrt(sum / present) : 0, finite }
}
export function displacement (actual: Float32Array, reference: Float32Array): { rms: number; max: number; compared: number } {
  if (actual.length !== reference.length) throw new Error('Position lengths differ')
  let sum = 0; let max = 0; let compared = 0
  for (let i = 0; i < reference.length; i += 4) {
    if (reference[i + 3] > 0.5) continue
    const distance = Math.hypot(actual[i] - reference[i], actual[i + 1] - reference[i + 1])
    const error = Number.isFinite(distance) ? distance : Infinity
    sum += error * error; max = Math.max(max, error); compared++
  }
  return { rms: compared ? Math.sqrt(sum / compared) : 0, max, compared }
}
