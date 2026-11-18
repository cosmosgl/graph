import { PARAMETERS, type Input } from '../many-body/data'
export const SETTINGS = { ...PARAMETERS, strength: 0.1 }
export type ClusterInput = Input & { membership: Int32Array; strengths: Float32Array; targets: Float32Array }
export const FIXTURES = ['semantics', 'balanced', 'uneven', 'single-group', 'targets'] as const
export type Fixture = typeof FIXTURES[number]
export function validate (input: ClusterInput): void {
  const n = input.points.length / 4; const groups = input.targets.length / 4
  if (!Number.isInteger(n) || n < 1 || n > 8192 || !Number.isInteger(groups) || groups < 1 || groups > 64 ||
    input.membership.length !== n || input.strengths.length !== n) throw new Error('Invalid cluster input dimensions')
  for (let i = 0; i < n; i++) {
    if (input.membership[i] < -1 || input.membership[i] >= groups || !Number.isFinite(input.strengths[i])) throw new Error('Invalid cluster assignment or strength')
  }
  if (!input.targets.every(Number.isFinite)) throw new Error('Cluster targets must be finite; use the presence flag for missing targets')
}
export function fixture (kind: Fixture, count = 1024): ClusterInput {
  const n = kind === 'semantics' ? 8 : count; const groups = kind === 'semantics' ? 4 : kind === 'single-group' ? 1 : 16
  const input: ClusterInput = {
    points: new Float32Array(n * 4),
    samples: new Float32Array(n * 2),
    membership: new Int32Array(n),
    strengths: new Float32Array(n).fill(1),
    targets: new Float32Array(groups * 4),
  }
  let seed = 29471
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < n; i++) {
    const group = kind === 'uneven' ? (i < n - 15 ? 0 : i - (n - 16)) : i % groups
    input.membership[i] = group
    const angle = 2 * Math.PI * group / groups
    input.points.set([Math.cos(angle) * 40 + (random() - 0.5) * 48, Math.sin(angle) * 40 + (random() - 0.5) * 48, 0, 0], i * 4)
    input.strengths[i] = i % 13 === 0 ? 0 : 0.5 + random()
  }
  if (kind === 'targets') {
    for (let g = 0; g < groups; g++) input.targets.set([(g % 4 - 1.5) * 30, (Math.floor(g / 4) - 1.5) * 30, 1, 0], g * 4)
  }
  if (kind === 'semantics') {
    input.points.set([-8, 0, 1, 0, 8, 0, 0, 0, 12, 4, 0, 0, 40, 10, 0, 0,
      NaN, NaN, 0, 1, 9000, -9000, 0, 1, -20, -12, 0, 0, 4, -4, 0, 0])
    input.membership.set([0, 0, 1, -1, 0, 0, 2, 2]); input.strengths.set([1, 2, 1, 1, 1, 1, 0, 0.5])
    input.targets.set([-20, -12, 1, 0], 8) // Negative custom target; group 3 is empty.
  }
  validate(input); return input
}
// Stable point IDs in each group. Build only when membership changes, never per tick.
export function grouping (input: ClusterInput): { members: Uint32Array; chunks: Uint32Array; ranges: Uint32Array } {
  validate(input)
  const lists = Array.from({ length: input.targets.length / 4 }, () => [] as number[])
  input.membership.forEach((group, point) => { if (group >= 0) lists[group].push(point) })
  const members: number[] = []; const chunks: number[] = []; const ranges: number[] = []
  for (const list of lists) {
    const start = chunks.length / 4
    for (let offset = 0; offset < list.length; offset += 256) {
      const slice = list.slice(offset, offset + 256)
      chunks.push(members.length, slice.length, 0, 0); members.push(...slice)
    }
    ranges.push(start, chunks.length / 4 - start, 0, 0)
  }
  return { members: new Uint32Array(members), chunks: new Uint32Array(chunks), ranges: new Uint32Array(ranges) }
}
