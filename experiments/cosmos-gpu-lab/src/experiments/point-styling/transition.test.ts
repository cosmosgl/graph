import { expect, it } from 'vitest'
import type { Device } from '@luma.gl/core'
import { createDevice } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { TOLERANCE } from '../many-body/reference'
import { pointTransitionReference, type PointTransitionData, type PointTransitionFrame, type PointTransitionOutput } from './transition-state'
import { createPointTransitionWebGL } from './transition-webgl'
import { createPointTransitionWebGPU } from './transition-webgpu'

function makeState (xy: readonly number[], sizes: readonly number[], overrides: Array<[number, readonly number[]]>): PointTransitionData {
  const positions = new Float32Array(xy.length * 2)
  const colors = new Float32Array(positions.length).fill(NaN)
  for (let i = 0; i < sizes.length; i++) positions.set([xy[i * 2], xy[i * 2 + 1], i, 0], i * 4)
  for (const [id, rgba] of overrides) colors.set(rgba, id * 4)
  return { positions, sizes: new Float32Array(sizes), colors }
}

const initial = makeState([
  -12, 4, -8, 8, NaN, NaN, NaN, NaN, 15, 14, 1, -3, 0.125, -0.625, -1, 3, -2, 0,
], [4, NaN, NaN, NaN, 16, 0, 3, NaN, 3], [
  [0, [0.125, 0.25, 0.5, 1]], [4, [0.75, NaN, 0.125, 1]], [5, [0, 0, 0, 1]], [6, [NaN, 0.75, 0.125, NaN]],
])
const revised = makeState([
  12, 10, NaN, NaN, 10, 2, NaN, NaN, NaN, NaN, 1, -3, 9.8, -0.3, 2, -3, -2, 0,
], [12, NaN, NaN, NaN, 16, 0, NaN, 7, 6], [
  [0, [0.75, 0.5, 0.25, 0.75]], [4, [0.75, NaN, 0.125, 1]], [6, [0.625, NaN, NaN, 0.75]], [8, [0.5, 0.75, 0.5, 0]],
])
const replacement = makeState([
  30, -10, NaN, NaN, 14, -4, NaN, NaN, -4, -6, 1, -3, -6, 9.5, -3, 3, -2, 0,
], [24, NaN, NaN, NaN, 9, 0, 6, 5, NaN], [[0, [0.25, 1, 0.5, 0.5]], [4, [NaN, 0.25, 0.75, 0.5]]])

const active = { positions: true, sizes: true, colors: true }
const cycles = [
  {
    name: 'enter and exit',
    target: revised,
    frames: [0, 12.5, 50, 87.5, 100].map(ms => ({ ms, ...active })).concat([
      { ms: 50, positions: false, sizes: false, colors: true },
    ]),
  },
  { name: 'interrupt in progress', target: initial, frames: [0, 37.5].map(ms => ({ ms, ...active })) },
  { name: 'restart', target: replacement, frames: [0, 25, 50, 100].map(ms => ({ ms, ...active })) },
]

function checkChannels (actual: Float32Array, expected: Float32Array, tupleSize: number): {
  failures: number; maxError: number; first: { index: number; expected: number; actual: number } | null;
} {
  if (actual.length !== expected.length) throw new Error('Transition readback length changed')
  let failures = 0; let maxError = 0; let first = null
  for (const [index, value] of expected.entries()) {
    const received = actual[index]
    if (Object.is(value, received) && ![Infinity, -Infinity].includes(value)) continue
    const error = Math.abs(value - received)
    if (Number.isFinite(error)) maxError = Math.max(maxError, error)
    const discrete = index % tupleSize === 2 || index % tupleSize === 3
    if (Number.isFinite(error) && !discrete && error <= TOLERANCE.absolute + TOLERANCE.relative * Math.abs(value)) continue
    failures++; first ??= { index, expected: value, actual: received }
  }
  return { failures, maxError, first }
}

function compare (actual: PointTransitionOutput, expected: PointTransitionOutput): {
  position: ReturnType<typeof checkChannels>; style: ReturnType<typeof checkChannels>;
} {
  return { position: checkChannels(actual.positions, expected.positions, 4), style: checkChannels(actual.styles, expected.styles, 8) }
}

it('has distinguishable midpoint, exit end, and style-only checks', () => {
  const middle = pointTransitionReference(initial.positions, initial.positions, initial, revised, { progress: 0.5, ...active })
  expect(Array.from(middle.positions.slice(0, 4))).toEqual([0, 7, 0, 1])
  expect(Array.from(middle.styles.slice(8, 12))).toEqual([6, 0.5, 1, 1])
  expect(Array.from(middle.positions.slice(8, 10))).toEqual([10, 2])
  expect(Array.from(middle.styles.slice(16, 20))).toEqual([6, 0.5, 0, 1])
  expect(Array.from(middle.styles.slice(32, 36))).toEqual([16, 0.5, 1, 1])
  const end = pointTransitionReference(initial.positions, middle.positions, initial, revised, { progress: 1, ...active })
  expect(Array.from(end.positions.slice(4, 6))).toEqual([-8, 8])
  expect(Array.from(end.styles.slice(8, 12))).toEqual([0, 1, 1, 0])
  const colorOnly = pointTransitionReference(initial.positions, end.positions, initial, revised,
    { progress: 0.5, positions: false, colors: true, sizes: false })
  expect(colorOnly.positions).toEqual(end.positions)
  expect(Array.from(colorOnly.styles.slice(8, 12))).toEqual([0, 1, 1, 0])
})

it('checks native GPU positions, fill, size, and exit at 12 fixed transition checkpoints', async () => {
  const scope = resourceScope()
  const own = scope.own
  const errors: string[] = []
  const adapters: Device['info'][] = []
  const rows = []
  let issue: string | null = null
  let lost = false
  const onError = (error: Error): boolean => { errors.push(error.message); return true }
  try {
    const gl = own(await createDevice('webgl', document.createElement('canvas'), false, onError))
    adapters.push(gl.info)
    const gpu = own(await createDevice('webgpu', undefined, false, onError))
    adapters.push(gpu.info)
    const control = own(createPointTransitionWebGL(gl, initial))
    const candidate = own(await createPointTransitionWebGPU(gpu, initial))
    let previous = initial
    let position = initial.positions
    let beforeRestart: Float32Array | undefined
    for (const cycle of cycles) {
      const from = position
      control.start(cycle.target)
      candidate.start(cycle.target)
      for (const { ms, ...flags } of cycle.frames) {
        const frame: PointTransitionFrame = { progress: ms / 100, ...flags }
        const expected = pointTransitionReference(from, position, previous, cycle.target, frame)
        const actualGL = await control.draw(frame)
        const actualGPU = await candidate.draw(frame)
        const firstPoint = (result: PointTransitionOutput): number[] => [...result.positions.slice(0, 2), ...result.styles.slice(0, 8)]
        const restart = cycle.name === 'restart' && ms === 0
          ? {
            positionsContinue: beforeRestart?.every((value, i) => Object.is(value, actualGPU.positions[i])) ?? false,
            sizeStartsAtPreviousTarget: actualGPU.styles[0] === previous.sizes[0],
            fillStartsAtPreviousTarget: actualGPU.styles.subarray(4, 8).every((value, i) => value === previous.colors[i]),
          }
          : null
        rows.push({
          cycle: cycle.name,
          ms,
          flags,
          webgl: compare(actualGL, expected),
          webgpu: compare(actualGPU, expected),
          pair: compare(actualGPU, actualGL),
          restart,
          firstPoint: { cpu: firstPoint(expected), webgl: firstPoint(actualGL), webgpu: firstPoint(actualGPU) },
        })
        if (cycle.name === 'interrupt in progress' && ms === 37.5) beforeRestart = actualGPU.positions.slice(0, 2)
        position = expected.positions
      }
      previous = cycle.target
    }
    lost = gl.isLost || gpu.isLost
  } catch (error) { issue = error instanceof Error ? error.message : String(error) } finally {
    scope.destroy()
    await writeArtifact('point-transition', {
      browser: navigator.userAgent,
      adapters,
      errors,
      lost,
      issue,
      rows,
      source: { revision: import.meta.env.LAB_SOURCE_REVISION, worktree: import.meta.env.LAB_WORKTREE_STATE, snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT },
    })
  }
  expect(issue).toBeNull()
  expect(errors).toEqual([])
  expect(lost).toBe(false)
  expect(rows).toHaveLength(12)
  for (const row of rows) {
    const fails = [row.webgl, row.webgpu, row.pair].some(check => check.position.failures > 0 || check.style.failures > 0)
    expect(fails, JSON.stringify(row)).toBe(false)
    if (row.restart) expect(Object.values(row.restart).every(Boolean), JSON.stringify(row)).toBe(true)
  }
})
