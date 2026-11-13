import { expect, it } from 'vitest'
import { compareArray } from '../many-body/reference'
import { createGraph, STAGES } from './data'
import { createOracle } from './reference'
import { repulsionMethod } from './repulsion-policy'
import { createCombinedWebGPU } from './webgpu'
import { differingBits } from './resident'
import { forceSettings } from './production-settings'

it('matches the inclusive production all-pairs cutoff and retains forced-grid controls', () => {
  for (const count of [4095, 4096, 4097, 8192]) {
    expect(repulsionMethod(count, 'production')).toBe(count <= 4096 ? 'exact' : 'hierarchical')
    expect(repulsionMethod(count, 'hierarchical')).toBe('hierarchical')
  }
})
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('preserves an evolving layout while crossing the production cutoff', async () => {
  const initial = createGraph({ count: 8192, fixture: 'chain', decay: 100, springPrecision: 'trig' })
  initial.input.points[2] = 1; initial.input.points[7] = 1
  const settings = forceSettings('varied32', 8192)
  const b = await createCombinedWebGPU(document.createElement('canvas'), initial.graph, initial.input, 'trig', {
    gpuBounds: true, repulsionPolicy: 'production', forceSettings: settings,
  })
  try {
    const identity = b.resourceIdentity!(); b.stepTick!(1, 0)
    let previous = (await b.read()).positions
    for (const [tick, count] of [4096, 4097, 4095, 8192].entries()) {
      const { graph, input } = createGraph({ count, fixture: 'chain', decay: 100, springPrecision: 'trig' })
      const expectedStart = input.points.slice(); expectedStart.set(previous.subarray(0, Math.min(previous.length, expectedStart.length)))
      const transfer = b.resizeGraph!(graph, input, true)
      expect(transfer.preserved).toBe(Math.min(previous.length / 4, count)); expect(b.resourceIdentity!()).toEqual(identity)
      expect(differingBits((await b.read()).positions, expectedStart)).toBe(0)
      b.stepTick!(1, tick + 1); previous = (await b.read()).positions
      const expected = createOracle(graph, input, 'production', settings).tick(expectedStart, 1, tick + 1)
      expect(compareArray(previous, expected)).toMatchObject({ valid: true })
    }
  } finally { b.destroy() }
})
for (const count of [4095, 4096, 4097, 8192]) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${count}: production route passes local stages and independent whole tick`, async () => {
    const { graph, input } = createGraph({ count, fixture: 'communities', decay: 100, springPrecision: 'trig' })
    input.points[2] = 1; input.points[7] = 1
    const oracle = createOracle(graph, input, 'production')
    const b = await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', { gpuBounds: true, repulsionPolicy: 'production' })
    try {
      expect(b.repulsionMethod!()).toBe(count <= 4096 ? 'exact' : 'hierarchical')
      let cpu = input.points; let gpu = input.points
      b.setGpuFrame!(0)
      for (const stage of STAGES) {
        const local = oracle.stage(stage, gpu, 1, 0)
        cpu = oracle.stage(stage, cpu, 1, 0).positions
        b.stepStage(stage, 1); const actual = await b.read()
        const check = { forces: compareArray(actual.forces, local.forces), positions: compareArray(actual.positions, local.positions) }
        expect(check.forces.valid && check.positions.valid, JSON.stringify({ stage, check })).toBe(true)
        gpu = actual.positions
      }
      expect(compareArray(gpu, cpu)).toMatchObject({ valid: true })
      b.setPositions(input.points); b.stepTick!(1, 0)
      expect(differingBits((await b.read()).positions, gpu)).toBe(0)
      if (count <= 4096) {
        await expect(b.readStructure()).rejects.toThrow('does not build a grid')
        await expect(b.profileCurrentFrame!(1, 0, [0, 0, 1, 1])).rejects.toThrow('grid profile')
      }
    } finally { b.destroy() }
  })
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('resident logical resize crosses the cutoff in both directions', async () => {
  const initial = createGraph({ count: 8192, fixture: 'chain', decay: 100, springPrecision: 'trig' })
  const b = await createCombinedWebGPU(document.createElement('canvas'), initial.graph, initial.input, 'trig',
    { gpuBounds: true, repulsionPolicy: 'production' })
  const identity = b.resourceIdentity!(); const buffer = b.positionSource!().buffer
  try {
    for (const count of [4096, 4097, 4095]) {
      const { graph, input } = createGraph({ count, fixture: 'chain', decay: 100, springPrecision: 'trig' })
      b.resizeGraph!(graph, input, false)
      expect(b.resourceIdentity!()).toEqual(identity); expect(b.positionSource!().buffer).toBe(buffer)
      expect(b.repulsionMethod!()).toBe(count <= 4096 ? 'exact' : 'hierarchical')
      b.stepTick!(1, 0)
      expect(compareArray((await b.read()).positions, createOracle(graph, input, 'production').tick(input.points, 1, 0))).toMatchObject({ valid: true })
      if (count <= 4096) {
        await expect(b.readCentroids!()).rejects.toThrow('does not build a grid')
        await expect(b.readBounds!()).rejects.toThrow('does not build a grid')
      }
    }
  } finally { b.destroy() }
})
