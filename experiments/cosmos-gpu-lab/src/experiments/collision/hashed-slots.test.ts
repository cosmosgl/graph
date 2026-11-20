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
import { createCollisionSlotsWebGL } from './hashed-webgl'
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

function describeDifference (actual: Float32Array, expected: Float32Array, absence?: Float32Array): ReturnType<typeof compareArray> & {
  witness: { index: number; actual: number; expected: number } | null;
} {
  const check = compareArray(actual, expected, absence)
  const index = check.worstIndex
  return { ...check, witness: check.valid || index < 0 ? null : { index, actual: actual[index], expected: expected[index] } }
}

function movementChecks (
  output: Float32Array, force: Float32Array, input: Float32Array, sizes: Float32Array, settings: CollisionParameters, moving: boolean
): { maskFailures: number; capFailures: number; movementMatches: boolean; moved: number } {
  let maskFailures = 0; let capFailures = 0; let moved = 0
  for (let offset = 0; offset < input.length; offset += 4) {
    const pinned = input[offset + 2] > 0.5
    const absent = input[offset + 3] > 0.5
    if ((pinned || absent) && (!Object.is(output[offset], input[offset]) || !Object.is(output[offset + 1], input[offset + 1]))) maskFailures++
    if (output[offset + 2] !== input[offset + 2] || output[offset + 3] !== input[offset + 3] ||
      (absent && (force[offset] !== 0 || force[offset + 1] !== 0))) maskFailures++
    const magnitude = Math.hypot(force[offset], force[offset + 1])
    if (!Number.isFinite(magnitude) || magnitude > radius(sizes[offset / 4], settings) + 2e-5) capFailures++
    if (!pinned && !absent && (output[offset] !== input[offset] || output[offset + 1] !== input[offset + 1])) moved++
  }
  return { maskFailures, capFailures, movementMatches: (moved > 0) === moving, moved }
}

it('uses the slot tier above the exact limit and exposes the declared duplicate and overflow controls', () => {
  expect(() => collisionSlotGrid(new Float32Array(4096), COLLISION, ORIGIN)).toThrow('4,097–1,000,000')
  expect(() => collisionSlotGrid(new Float32Array(1000001), COLLISION, ORIGIN)).toThrow('4,097–1,000,000')
  expect(collisionSlotGrid(new Float32Array(1000000), COLLISION, ORIGIN)).toMatchObject({ edge: 512, capacity: 8 })
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
  it(`preserves slots and correction bytes with alternate collision cell lookups at ${count} points`, async () => {
    const { points, sizes, settings, frames } = fixture(count)
    const scope = resourceScope()
    try {
      const device = scope.own(await createDevice('webgpu'))
      const positions = scope.own(upload(device, points))
      const variants = []
      for (const lookup of ['direct', 'cached', 'power-of-two'] as const) {
        const forces = scope.own(upload(device, new Float32Array(points.length)))
        variants.push({ lookup, forces, solver: scope.own(await createCollisionSlotsWebGPU(device, sizes, forces, settings, ORIGIN, undefined, lookup)) })
      }
      const [direct, ...alternates] = variants
      for (const frame of frames) {
        variants.forEach(({ solver }) => { solver.prepare(frame) })
        const pass = device.beginComputePass()
        try { variants.forEach(({ solver }) => { solver.encode(pass, positions) }) } finally { pass.end() }
        await waitForGpu(device)
        const directSlots = await direct.solver.readSlots()
        const directBytes = await direct.forces.readAsync()
        for (const { lookup, forces, solver } of alternates) {
          expect(compareSlots(await solver.readSlots(), directSlots), lookup).toMatchObject({ failures: 0 })
          const bytes = await forces.readAsync()
          expect(bytes.every((value, offset) => value === directBytes[offset]), lookup).toBe(true)
        }
      }
    } finally { scope.destroy() }
  })
}

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
    let webglInfo: string | null = null
    try {
      const forces = own(upload(device, new Float32Array(points.length)))
      const positions = [own(upload(device, points)), own(upload(device, points))]
      const params = own(upload(device, new Float32Array([count, 0, 0, 0, 1, 4096, 0, 0]), Buffer.UNIFORM))
      const integrate = own(await createRoundedKernel(device, roundedIntegrationSource(), bindingLayout([
        ['positions', 'read-only-storage'], ['forces', 'read-only-storage'], ['params', 'uniform'], ['output', 'storage'],
      ])))
      const slots = own(await createCollisionSlotsWebGPU(device, sizes, forces, settings, ORIGIN))
      ownedBytes = slots.bytes
      const webgl = own(await createCollisionSlotsWebGL(points, sizes, settings, ORIGIN))
      webglInfo = webgl.info
      const capacity = collisionSlotGrid(sizes, settings, ORIGIN).capacity
      let cpu = points
      let previous = points
      let webglPrevious = points
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
        webgl.setPositions(previous)
        webgl.step(frame)
        const glSlots = webgl.readSlots()
        const gl = await webgl.read()
        let glIndependent = gl
        if (webglPrevious !== previous) {
          webgl.setPositions(webglPrevious)
          webgl.step(frame)
          glIndependent = await webgl.read()
        }
        const glReference = compareSlots(glSlots.ids, expected.slots)
        const comparison = compareSlots(glSlots.ids, actualSlots)
        const first = comparison.first ?? glReference.first
        const expectedMovement = frame.alpha > 0 || settings.cooling === 0
        rows.push({
          frame,
          slots: compareSlots(actualSlots, expected.slots),
          force: describeDifference(actualForce, expected.forces),
          positions: describeDifference(actualPosition, expected.positions, previous),
          trajectory: describeDifference(actualPosition, independent.positions, cpu),
          ...movementChecks(actualPosition, actualForce, previous, sizes, settings, expectedMovement),
          webgl: {
            slots: glReference,
            force: describeDifference(gl.forces, expected.forces),
            positions: describeDifference(gl.positions, expected.positions, previous),
            trajectory: describeDifference(glIndependent.positions, independent.positions, cpu),
            ...movementChecks(glIndependent.positions, glIndependent.forces, webglPrevious, sizes, settings, expectedMovement),
          },
          direct: {
            slots: comparison,
            force: describeDifference(actualForce, gl.forces),
            positions: describeDifference(actualPosition, gl.positions, previous),
            trajectory: describeDifference(actualPosition, glIndependent.positions, previous),
            firstSlot: first ? { bucket: Math.floor(first.index / capacity), slot: first.index % capacity, webglHash: glSlots.hashes[first.index] } : null,
          },
          maxOccupancy: expected.maxOccupancy,
          overflow: expected.overflow,
          aliasedBuckets: expected.aliases,
          equalHashes: expected.ties,
          expectedMovement,
        })
        cpu = independent.positions
        previous = actualPosition
        webglPrevious = glIndependent.positions
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
        webglInfo,
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
        row.maskFailures === 0 && row.capFailures === 0 && row.movementMatches, JSON.stringify(row)).toBe(true)
      expect(row.webgl.slots.failures === 0 && row.webgl.force.valid && row.webgl.positions.valid && row.webgl.trajectory.valid &&
        row.webgl.maskFailures === 0 && row.webgl.capFailures === 0 && row.webgl.movementMatches, JSON.stringify(row)).toBe(true)
      expect(row.direct.slots.failures === 0 && row.direct.force.valid && row.direct.positions.valid && row.direct.trajectory.valid,
        JSON.stringify(row)).toBe(true)
    }
  }, 120000)
}
