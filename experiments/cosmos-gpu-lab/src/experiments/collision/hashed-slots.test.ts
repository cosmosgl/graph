import { Buffer } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { createDevice, bindingLayout, readFloats, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { createRoundedKernel, roundedIntegrationSource } from '../combined-layout/spring-precision'
import { compareArray } from '../many-body/reference'
import { COLLISION, radius, type CollisionParameters } from './data'
import { collisionSlotGrid, type CollisionSlotFrame } from './hashed-grid'
import { collisionSlotsReference } from './hashed-reference'
import { createCollisionSlotsWebGPU } from './hashed-webgpu'

const ORIGIN = [127.5, -63.25] as const
const COUNTS = [4097, 8192] as const
const SEEDS = [0, 0.125, 0.25, 0.375, 0.5]

function fixture (count: typeof COUNTS[number]): { points: Float32Array; sizes: Float32Array; settings: CollisionParameters; frames: CollisionSlotFrame[] } {
  const points = new Float32Array(count * 4)
  const sizes = new Float32Array(count)
  const put = (i: number, x: number, y: number, pinned = 0, absent = 0): void => {
    points.set([ORIGIN[0] + x, ORIGIN[1] + y, pinned, absent], i * 4)
  }
  for (let i = 0; i < count; i++) {
    put(i, 100 + (i % 128) * 30, 240 + Math.floor(i / 128) * 30)
    sizes[i] = 4 + (i % 5) * 2
  }
  // A pinned blocker across the sign seam, absent NaN and finite points, and
  // a coincident movable point at the final index.
  put(0, -0.25, 0.5, 1); put(1, 0.25, 0.5)
  put(2, NaN, NaN, 0, 1); put(3, -0.125, 0.5, 0, 1)
  put(5, 66, -78, 1); put(count - 1, 66, -78)
  if (count === 4097) {
    // Two touching cells at the intersection of rotated block boundaries
    // share a bucket at tick zero, and must each contribute just once.
    put(6, -10752 * 12.5 - 2, 15872 * 12.5 - 2)
    put(7, -10752 * 12.5 + 2, 15872 * 12.5 + 2)
    sizes[6] = sizes[7] = 12
  } else {
    // [2, 2] and [258, 241] wrap to the same 256-grid bucket at tick zero.
    for (let i = 20; i < 74; i++) put(i, 18.125 + (i % 8) * 0.5, 18.375 + (i % 7) * 0.5)
    for (let i = 74; i < 90; i++) put(i, 2066.25 + (i % 4) * 0.75, 1930.5 + (i % 7) * 0.5)
    // These IDs share the same f32 peel hash at seed zero in their own cell.
    put(3288, -38.75, 12.25, 1); put(5362, -37.5, 12.25)
  }
  const alphas = count === 4097 ? [0, 1, 0.5, 0.25] : [1, 0.64, 0, 0.36, 0.25]
  const settings = count === 4097 ? COLLISION : { ...COLLISION, radius: 3, padding: 0.5, cooling: 0.5 }
  return { points, sizes, settings, frames: alphas.map((alpha, tick) => ({ tick, alpha, seed: SEEDS[tick] })) }
}

function compareSlots (actual: Uint32Array, expected: Uint32Array): {
  failures: number; first: { index: number; actual: number; expected: number } | null;
} {
  if (actual.length !== expected.length) throw new Error('Collision slot readback length changed')
  let failures = 0
  let first = null
  for (const [index, element] of expected.entries()) {
    if (actual[index] === element) continue
    failures++
    first ??= { index, actual: actual[index], expected: element }
  }
  return { failures, first }
}

it('uses the slot tier above the exact limit and exposes the declared duplicate and overflow controls', () => {
  expect(() => collisionSlotGrid(new Float32Array(4096), COLLISION, ORIGIN)).toThrow('4,097–8,192')
  expect(() => collisionSlotGrid(new Float32Array(8193), COLLISION, ORIGIN)).toThrow('4,097–8,192')
  const small = fixture(4097)
  const project = collisionSlotsReference(small.points, small.sizes, small.settings, ORIGIN, small.frames[0])
  const seamSlots = [project.slots.indexOf(7), project.slots.indexOf(8)]
  expect(seamSlots[0]).toBeGreaterThanOrEqual(0)
  expect(seamSlots[1]).toBeGreaterThanOrEqual(0)
  expect(Math.floor(seamSlots[0] / 32)).toBe(Math.floor(seamSlots[1] / 32))
  expect(project.forces[6 * 4]).toBeCloseTo(-(12.5 - Math.hypot(4, 4)) / (2 * Math.SQRT2), 5)
  expect(project.forces[4]).toBeGreaterThan(0)
  expect(project.positions[0]).toBe(small.points[0])
  const dense = fixture(8192)
  const setup = collisionSlotsReference(dense.points, dense.sizes, dense.settings, ORIGIN, dense.frames[0])
  const changed = collisionSlotsReference(dense.points, dense.sizes, dense.settings, ORIGIN, dense.frames[1])
  expect(setup.maxOccupancy).toBeGreaterThanOrEqual(70)
  expect(changed.maxOccupancy).toBeLessThan(setup.maxOccupancy)
  expect(setup.overflow).toBeGreaterThan(0)
  expect(setup.ties).toBeGreaterThan(0)
  expect(setup.slots.indexOf(3289)).toBeGreaterThanOrEqual(0)
  expect(setup.slots.indexOf(5363)).toBe(-1)
  expect(setup.forces[3288 * 4]).toBe(0)
  expect(setup.forces[5362 * 4]).toBeCloseTo(2.875, 5)
})

for (const count of COUNTS) {
  it(`matches independent slot order, correction and moving positions for ${count} points`, async () => {
    const { points, sizes, settings, frames } = fixture(count)
    const scope = resourceScope()
    const own = scope.own
    const errors: string[] = []
    const device = await createDevice('webgpu', undefined, false, error => { errors.push(error.message); return true })
    const rows = []
    let issue: string | null = null
    let ownedBytes: number | null = null
    try {
      const forces = own(upload(device, new Float32Array(points.length)))
      const positions = [own(upload(device, points)), own(upload(device, points))]
      const params = own(upload(device, new Float32Array([count, 0, 0, 0, 1, 4096, 0, 0]), Buffer.UNIFORM))
      const integrate = own(await createRoundedKernel(device, roundedIntegrationSource(), bindingLayout([
        ['positions', 'read-only-storage'], ['forces', 'read-only-storage'], ['params', 'uniform'], ['output', 'storage'],
      ])))
      const slots = own(await createCollisionSlotsWebGPU(device, sizes, forces, settings, ORIGIN))
      ownedBytes = slots.bytes
      let cpu = points
      let previous = points
      let source = 0
      for (const frame of frames) {
        const expected = collisionSlotsReference(previous, sizes, settings, ORIGIN, frame)
        const independent = previous === cpu ? expected : collisionSlotsReference(cpu, sizes, settings, ORIGIN, frame)
        slots.prepare(frame)
        const pass = device.beginComputePass()
        const output = positions[1 - source]
        try {
          slots.encode(pass, positions[source])
          integrate.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions: positions[source], forces, params, output } })
        } finally { pass.end() }
        await waitForGpu(device)
        const actualSlots = await slots.readSlots()
        const actualForce = await readFloats(forces)
        const actualPosition = await readFloats(output)
        let maskFailures = 0; let capFailures = 0; let moved = 0
        for (let offset = 0; offset < points.length; offset += 4) {
          const pinned = points[offset + 2] > 0.5
          const absent = points[offset + 3] > 0.5
          if ((pinned || absent) && (!Object.is(actualPosition[offset], points[offset]) ||
            !Object.is(actualPosition[offset + 1], points[offset + 1]))) maskFailures++
          if (actualPosition[offset + 2] !== points[offset + 2] || actualPosition[offset + 3] !== points[offset + 3] ||
            (absent && (actualForce[offset] !== 0 || actualForce[offset + 1] !== 0))) maskFailures++
          const magnitude = Math.hypot(actualForce[offset], actualForce[offset + 1])
          if (!Number.isFinite(magnitude) || magnitude > radius(sizes[offset / 4], settings) + 2e-5) capFailures++
          if (!pinned && !absent && (actualPosition[offset] !== previous[offset] || actualPosition[offset + 1] !== previous[offset + 1])) moved++
        }
        rows.push({
          frame,
          slots: compareSlots(actualSlots, expected.slots),
          force: compareArray(actualForce, expected.forces),
          positions: compareArray(actualPosition, expected.positions, previous),
          trajectory: compareArray(actualPosition, independent.positions, cpu),
          maskFailures,
          capFailures,
          moved,
          maxOccupancy: expected.maxOccupancy,
          overflow: expected.overflow,
          aliasedBuckets: expected.aliases,
          equalHashes: expected.ties,
          expectedMovement: frame.alpha > 0 || settings.cooling === 0,
        })
        cpu = independent.positions
        previous = actualPosition
        source = 1 - source
      }
    } catch (error) { issue = error instanceof Error ? error.message : String(error) } finally {
      const lost = device.isLost
      const adapter = device.info
      scope.destroy()
      device.destroy()
      await writeArtifact(`collision-hashed-${count}`, {
        count,
        settings,
        origin: ORIGIN,
        frames,
        adapter,
        browser: navigator.userAgent,
        visible: document.visibilityState,
        ownedBytes,
        errors,
        lost,
        issue,
        rows,
        source: {
          revision: import.meta.env.LAB_SOURCE_REVISION, worktree: import.meta.env.LAB_WORKTREE_STATE, snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
        },
      })
      expect(issue).toBeNull()
      expect(errors).toEqual([])
      expect(lost).toBe(false)
    }
    expect(rows.length).toBe(frames.length)
    for (const row of rows) {
      expect(row.slots.failures === 0 && row.force.valid && row.positions.valid && row.trajectory.valid &&
        row.maskFailures === 0 && row.capFailures === 0 && (row.moved > 0) === row.expectedMovement, JSON.stringify(row)).toBe(true)
    }
  }, 120000)
}
