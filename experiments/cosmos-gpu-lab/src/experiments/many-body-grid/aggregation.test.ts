import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { differingBits } from '../combined-layout/resident'
import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { buildReference, frameFor } from './data'
import { createGridWebGPU } from './webgpu'
import { aggregationWork } from './aggregation'
it('reports dense fallback work at the exact 128-source boundary', () => {
  for (const count of [128, 129]) {
    const { points } = createFixture('coincident', count); const frame = frameFor(points, 0)
    const work = aggregationWork(points, frame)
    expect(work.every(w => w.occupied === 1 && w.maxOccupancy === count && w.dense === Number(count > 128))).toBe(true)
    expect(work.reduce((sum, w) => sum + w.denseSourceTests, 0)).toBe(count > 128 ? count * work.length : 0)
  }
})
const cases: Array<[Fixture, number]> = [
  ['uniform', 8192], ['clusters', 8192], ['coincident', 32], ['coincident', 33], ['coincident', 129], ['edge-cases', 8],
]
for (const candidate of ['cached-cells', 'cached-small'] as const) {
  for (const [fixture, count] of cases) {
    it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${candidate}/${fixture}/${count}: exact structure and output bits`, async () => {
      const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
      const ledgers = [new BufferLedger(), new BufferLedger()]; const backends = []
      const input = createFixture(fixture, count)
      try {
        for (const [lane, aggregation] of (['baseline', candidate] as const).entries()) {
          backends.push(await createGridWebGPU(canvas, input, PARAMETERS, frameFor(input.points, 0), 'streamed', factory => factory, {
            aggregation, context: { device, ledger: ledgers[lane] },
          }))
        }
        for (const tick of [0, 7]) {
          const points = input.points.slice()
          if (tick) { points[3] = 1; points[6] = 1 } // Refresh absent membership and retain pinned mass.
          const frame = frameFor(points, tick); const expected = buildReference(points, frame)
          for (const b of backends) { b.setPositions(points); b.setFrame(frame); b.step() }
          const structures = await Promise.all(backends.map(b => b.readStructure()))
          const snapshots = await Promise.all(backends.map(b => b.read()))
          const centroids = await Promise.all(backends.map(b => b.readCentroids!()))
          expect(differingBits(structures[0].aggregates, expected.aggregates)).toBe(0)
          expect(differingBits(structures[1].aggregates, expected.aggregates)).toBe(0)
          expect(differingBits(structures[0].slots, structures[1].slots)).toBe(0)
          expect(differingBits(centroids[0], centroids[1])).toBe(0)
          expect(differingBits(snapshots[0].positions, snapshots[1].positions)).toBe(0)
          expect(differingBits(snapshots[0].forces, snapshots[1].forces)).toBe(0)
        }
      } finally { backends.forEach(b => b.destroy()); device.destroy() }
      expect(ledgers.map(l => l.liveBytes)).toEqual([0, 0])
    })
  }
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('refreshes membership stride across retained-buffer shrink/grow changes', async () => {
  const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
  const input = createFixture('coincident', 512); const backends = []
  try {
    for (const aggregation of ['baseline', 'cached-small'] as const) {
      backends.push(await createGridWebGPU(canvas, input, PARAMETERS, frameFor(input.points, 0), 'streamed', factory => factory, {
        aggregation, context: { device },
      }))
    }
    for (const count of [33, 128, 65, 512]) {
      const next = createFixture('coincident', count); next.points[7] = 1
      for (const b of backends) { b.resizeInput!(next, false); b.setFrame(frameFor(next.points, count)); b.step() }
      const structures = await Promise.all(backends.map(b => b.readStructure()))
      const snapshots = await Promise.all(backends.map(b => b.read()))
      expect(differingBits(structures[0].aggregates, structures[1].aggregates)).toBe(0)
      expect(differingBits(structures[0].slots, structures[1].slots)).toBe(0)
      expect(differingBits(snapshots[0].positions, snapshots[1].positions)).toBe(0)
      expect(differingBits(snapshots[0].forces, snapshots[1].forces)).toBe(0)
    }
  } finally { backends.forEach(b => b.destroy()); device.destroy() }
})
