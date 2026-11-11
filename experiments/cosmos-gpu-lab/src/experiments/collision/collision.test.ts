import { expect, it } from 'vitest'
import { compareArray } from '../many-body/reference'
import { createCombinedWebGL } from '../combined-layout/webgl'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import { createOracle } from '../combined-layout/reference'
import { forceSettings } from '../combined-layout/production-settings'
import { stagesFor } from '../combined-layout/data'
import { COLLISION, createFixture, radius } from './data'
import { collisionReference } from './reference'
import { collisionView } from './camera'
import { stageCheck } from './checks'
it('projects unequal discs, caps the correction, and keeps collision active at alpha zero', () => {
  const { input, graph } = createFixture('pair')
  const p = { ...COLLISION, padding: 0 }
  const result = collisionReference(input.points, graph.sizes, p, 0)
  expect(result.forces[0]).toBe(-4); expect(result.forces[4]).toBeCloseTo(1.2, 6)
  expect(result.positions[0]).toBe(2041)
  expect(collisionReference(input.points, graph.sizes, { ...p, cooling: 1 }, 0).forces.every(v => v === 0)).toBe(true)
  expect(radius(8, { ...p, radius: 3, padding: 0.5 })).toBe(3.5)
})
it('preserves pins and absent NaNs while excluding absent finite blockers', () => {
  const { input, graph } = createFixture('masks'); const result = collisionReference(input.points, graph.sizes, COLLISION, 1)
  expect(result.positions[0]).toBe(input.points[0]); expect(Number.isNaN(result.positions[8])).toBe(true)
  expect(result.forces.slice(8, 16)).toEqual(new Float32Array(8))
  const removed = input.points.slice(); removed[12] = 9000; removed[13] = -9000
  expect(collisionReference(removed, graph.sizes, COLLISION, 1).forces).toEqual(result.forces)
})
it('fits whole discs across both timing controls in one shared camera', () => {
  const { input, graph } = createFixture('pair'); const displaced = input.points.slice(); displaced[4] += 100
  const p = { ...COLLISION, radius: 64 }; const view = collisionView([input.points, displaced], graph.sizes, p)
  for (const points of [input.points, displaced]) {
    for (let i = 0; i < graph.sizes.length; i++) {
      expect((Math.abs(points[i * 4] - view[0]) + radius(graph.sizes[i], p)) * view[2]).toBeLessThan(1)
      expect((Math.abs(points[i * 4 + 1] - view[1]) + radius(graph.sizes[i], p)) * view[3]).toBeLessThan(1)
    }
  }
})
it('excludes only unused absent spring corrections, preserving collision zero and present-force checks', () => {
  const positions = new Float32Array([NaN, NaN, 0, 1]); const forces = new Float32Array([NaN, NaN, 0, 0])
  const actual = { positions, forces }; const check = stageCheck('outgoing', actual, actual, positions)
  expect(check.valid).toBe(true); expect(check.absentSpringTargets).toBe(1)
  expect(stageCheck('collision', actual, { positions, forces: new Float32Array(4) }, positions).valid).toBe(false)
  expect(stageCheck('outgoing', actual, actual, new Float32Array(4)).valid).toBe(false)
})
for (const [api, arithmetic] of [['webgl', 'strict'], ['webgpu', 'strict'], ['webgpu', 'native']] as const) {
  for (const fixture of ['pair', 'masks', 'coincident', 'uniform', 'clusters', 'separated'] as const) {
    it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${api}/${arithmetic}: exact collision / ${fixture}`, async () => {
      const { input, graph } = createFixture(fixture, fixture === 'clusters' ? 512 : 128)
      const settings = { ...forceSettings('varied32', graph.sizes.length), collision: { ...COLLISION }, collisionArithmetic: arithmetic }
      const b = api === 'webgl'
        ? await createCombinedWebGL(document.createElement('canvas'), graph, input, { forceSettings: settings, repulsionPolicy: 'production' })
        : await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', {
          forceSettings: settings, repulsionPolicy: 'production', gpuBounds: true,
        })
      try {
        let previous = input.points
        for (let iteration = 0; iteration < 4; iteration++) {
          const expected = collisionReference(previous, graph.sizes, settings.collision, 0)
          b.stepStage('collision', 0); const actual = await b.read()
          const checks = { forces: compareArray(actual.forces, expected.forces), positions: compareArray(actual.positions, expected.positions, previous) }
          expect(checks.forces.valid && checks.positions.valid, JSON.stringify(checks)).toBe(true)
          previous = actual.positions
        }
      } finally { b.destroy() }
    }, 120000)
  }
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${api}/${arithmetic}: composed force order and collision spring floor`, async () => {
    const { input, graph } = createFixture('uniform', 128)
    const settings = {
      ...forceSettings('varied32', 128),
      center: 1,
      origin: [2048, 2048] as [number, number],
      collision: { ...COLLISION, radius: 8, iterations: 2 },
      collisionArithmetic: arithmetic,
    }
    const oracle = createOracle(graph, input, 'production', settings)
    const b = api === 'webgl'
      ? await createCombinedWebGL(document.createElement('canvas'), graph, input, { forceSettings: settings, repulsionPolicy: 'production' })
      : await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', {
        forceSettings: settings, repulsionPolicy: 'production', gpuBounds: true,
      })
    try {
      for (const stage of stagesFor(1, settings.collision)) b.stepStage(stage, 1)
      const check = compareArray((await b.read()).positions, oracle.tick(input.points, 1, 0))
      expect(check.valid, JSON.stringify(check)).toBe(true)
    } finally { b.destroy() }
  }, 120000)
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${api}/${arithmetic}: cooling, radius override and high-index coincidence`, async () => {
    const { input, graph } = createFixture('separated', 4096)
    for (let i = 0; i < graph.sizes.length; i++) input.points[i * 4 + 3] = 1
    input.points.set([0, 0, 1, 0], 0); input.points.set([0, 0, 0, 0], 4095 * 4)
    const settings = { ...forceSettings('reference', 4096), collision: { ...COLLISION, radius: 4, padding: 1 }, collisionArithmetic: arithmetic }
    const b = api === 'webgl'
      ? await createCombinedWebGL(document.createElement('canvas'), graph, input, { forceSettings: settings, repulsionPolicy: 'production' })
      : await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', {
        forceSettings: settings, repulsionPolicy: 'production', gpuBounds: true,
      })
    try {
      for (const cooling of [0, 0.5, 1, 2]) {
        for (const alpha of [0, 0.01, 1]) {
          settings.collision.cooling = cooling; b.setPositions(input.points); b.stepStage('collision', alpha)
          const actual = await b.read(); const expected = collisionReference(input.points, graph.sizes, settings.collision, alpha)
          const check = { force: compareArray(actual.forces, expected.forces), position: compareArray(actual.positions, expected.positions, input.points) }
          expect(check.force.valid && check.position.valid, JSON.stringify({ cooling, alpha, check })).toBe(true)
        }
      }
    } finally { b.destroy() }
  }, 120000)
}
