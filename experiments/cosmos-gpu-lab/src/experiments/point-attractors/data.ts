import { PARAMETERS, validateInput, type Input } from '../many-body/data'
export const SETTINGS = { ...PARAMETERS, strength: 0.1 }
export type Settings = typeof SETTINGS
// Raw public channels: a mismatched length disables the channel, as in GraphData.
export type AttractorInput = Input & { targets?: Float32Array; strengths?: Float32Array }
export const FIXTURES = ['semantics', 'shared-target', 'individual-targets', 'mixed', 'translated'] as const
export type Fixture = typeof FIXTURES[number]
export function validate (input: AttractorInput, settings = SETTINGS): void {
  validateInput(input, settings, 8192)
  if (input.points.length < 4 || !Number.isFinite(settings.strength)) throw new Error('Expected points and a finite attractor coefficient')
}
export function packAttractors (input: AttractorInput): { values: Float32Array; active: boolean } {
  const n = input.points.length / 4; const values = new Float32Array(n * 4)
  let active = false
  if (input.targets?.length !== n * 2) return { values, active }
  const strengths = input.strengths?.length === n ? input.strengths : undefined
  for (let i = 0; i < n; i++) {
    const x = input.targets[i * 2]; const y = input.targets[i * 2 + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const strength = strengths?.[i]
    values.set([x, y, strength !== undefined && Number.isFinite(strength) ? strength : 1, 1], i * 4)
    active = true
  }
  return { values, active }
}
export function fixture (kind: Fixture, count = 1024): AttractorInput {
  const n = kind === 'semantics' ? 12 : count
  const points = new Float32Array(n * 4); const targets = new Float32Array(n * 2); const strengths = new Float32Array(n).fill(1)
  const input = { points, samples: new Float32Array(n * 2), targets, strengths }
  let seed = 29471
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const offset = kind === 'translated' ? 2048 : 0
  for (let i = 0; i < n; i++) {
    points.set([offset + (random() * 2 - 1) * 64, offset + (random() * 2 - 1) * 64, 0, 0], i * 4)
    if (kind !== 'shared-target') targets.set([offset + Math.cos(2 * Math.PI * i / n) * 40, offset + Math.sin(2 * Math.PI * i / n) * 40], i * 2)
    strengths[i] = 0.5 + random()
    if (kind === 'mixed') {
      if (i % 11 === 0) targets[i * 2] = NaN
      if (i % 13 === 0) strengths[i] = 0
      else if (i % 17 === 0) strengths[i] = -0.25
      else if (i % 19 === 0) strengths[i] = NaN
      if (i % 23 === 0) points[i * 4 + 2] = 1
      if (i % 29 === 0) points[i * 4 + 3] = 1
    }
  }
  if (kind === 'semantics') {
    points.set([-8, 0, 1, 0, 8, 0, 0, 0, 12, 4, 0, 0, 40, 10, 0, 0,
      NaN, NaN, 0, 1, 9000, -9000, 0, 1, -20, -12, 0, 0, 4, -4, 0, 0,
      -8, 8, 0, 0, 16, -8, 0, 0, -6, -6, 0, 0, 6, 6, 0, 0])
    targets.set([0, 0, 0, 0, 12, 4, NaN, 1, 0, 0, 0, 0, -10, -6, -12, -16,
      8, -8, 0, Infinity, 0, 0, 0, 0])
    strengths.set([1, 2, 1, 1, 1, 1, 0, 0.5, -0.5, 1, NaN, Infinity])
  }
  validate(input); return input
}
export function changedTargets (input: AttractorInput): AttractorInput {
  const n = input.points.length / 4; const targets = new Float32Array(n * 2); const strengths = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    // Move each finite target locally, including the translated fixture.
    const x = input.targets?.[i * 2]; const y = input.targets?.[i * 2 + 1]
    targets.set([Number.isFinite(x) ? x! + 8 : -24, Number.isFinite(y) ? y! - 12 : 12], i * 2)
    strengths[i] = i % 3 ? 0.75 : 0
  }
  return { ...input, targets, strengths }
}
