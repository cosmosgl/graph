import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { differingBits } from '../combined-layout/resident'
import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { buildReference, frameFor } from './data'
import { gridReference, comparePresent } from './reference'
import { compareStructure } from './validation'
import { createGridWebGPU } from './webgpu'
import { farResources } from './far-resources'
import { createTrace, traceChecks } from './trace'

it('bounds scratch by chunk size while retaining cumulative per-level sums', () => {
  const million = 1000000; const chunkSize = 16384
  const streamed = farResources(million, 'streamed')
  const chunked = farResources(million, 'chunked', chunkSize)
  expect(streamed.extraStorageBytes - chunked.extraStorageBytes).toBe((million - chunkSize) * 100 * 8)
  expect(chunked.extraDispatches).toBeGreaterThan(streamed.extraDispatches)
})

for (const [fixture, count, chunkSize, precise] of [
  ['edge-cases', 8, 3, true],
  ['uniform', 257, 17, false],
  ['coincident', 65, 17, true],
  ['clusters', 4097, 512, true],
  ['uniform', 8192, 1024, true],
] as Array<[Fixture, number, number, boolean]>) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`chunked ${fixture}/${count}/${chunkSize}: retains the original grid, force and integration`, async () => {
    const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
    const input = createFixture(fixture, count); const backends = []; const ledgers = [new BufferLedger(), new BufferLedger()]
    try {
      for (const [i, mode] of (['streamed', 'chunked'] as const).entries()) {
        backends.push(await createGridWebGPU(canvas, input, PARAMETERS, frameFor(input.points, 0, 8, precise), mode, factory => factory, {
          context: { device, ledger: ledgers[i] }, farChunkSize: chunkSize,
        }))
      }
      for (const tick of [0, 7]) {
        const points = input.points.slice()
        if (tick && points.length >= 8) { points[2] = 1; points[7] = 1 }
        const frame = frameFor(points, tick, 8, precise); const structure = buildReference(points, frame)
        const expected = gridReference(input, points, PARAMETERS, frame, structure)
        for (const backend of backends) { backend.setPositions(points); backend.setFrame(frame); backend.step() }
        const snapshots = await Promise.all(backends.map(backend => backend.read()))
        const grids = await Promise.all(backends.map(backend => backend.readStructure()))
        const centers = await Promise.all(backends.map(backend => backend.readCentroids!()))
        expect(grids.every(grid => compareStructure(grid, structure).valid)).toBe(true)
        expect(snapshots.every(snapshot => comparePresent(snapshot, expected, points).valid)).toBe(true)
        expect(differingBits(grids[0].aggregates, grids[1].aggregates)).toBe(0)
        expect(differingBits(grids[0].slots, grids[1].slots)).toBe(0)
        expect(differingBits(centers[0], centers[1])).toBe(0)
        expect(differingBits(snapshots[0].forces, snapshots[1].forces)).toBe(0)
        expect(differingBits(snapshots[0].positions, snapshots[1].positions)).toBe(0)
        if (fixture === 'uniform' && count === 257 && tick === 0) {
          const referenceTrace = createTrace(count)
          gridReference(input, points, PARAMETERS, frame, structure, referenceTrace)
          const trace = await backends[1].diagnose!()
          expect(differingBits(trace.forces, snapshots[1].forces)).toBe(0)
          expect(traceChecks(trace.trace, referenceTrace, points).every(check => check.check.valid)).toBe(true)
        }
      }
      if (count > chunkSize * 2) expect(ledgers[1].liveBytes).toBeLessThan(ledgers[0].liveBytes)
    } finally { backends.forEach(backend => backend.destroy()); device.destroy() }
    expect(ledgers.map(ledger => ledger.liveBytes)).toEqual([0, 0])
  }, 120000)
}

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('reuses chunk uniforms when point counts shrink and grow', async () => {
  const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
  const input = createFixture('uniform', 257); const backends = []
  try {
    for (const mode of ['streamed', 'chunked'] as const) {
      backends.push(await createGridWebGPU(canvas, input, PARAMETERS, frameFor(input.points, 0), mode, factory => factory, {
        context: { device }, farChunkSize: 17,
      }))
    }
    for (const count of [1, 16, 17, 18, 129, 257]) {
      const next = createFixture('uniform', count)
      for (const backend of backends) { backend.resizeInput!(next, false); backend.setFrame(frameFor(next.points, count)); backend.step() }
      const results = await Promise.all(backends.map(backend => backend.read()))
      expect(differingBits(results[0].forces, results[1].forces)).toBe(0)
      expect(differingBits(results[0].positions, results[1].positions)).toBe(0)
    }
  } finally { backends.forEach(backend => backend.destroy()); device.destroy() }
}, 120000)

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('repeats frozen force and step batches with unchanged chunked outputs', async () => {
  const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
  const input = createFixture('uniform', 257); const frame = frameFor(input.points, 0)
  const backends = []
  try {
    for (const mode of ['streamed', 'chunked'] as const) {
      backends.push(await createGridWebGPU(canvas, input, PARAMETERS, frame, mode, factory => factory, {
        context: { device }, farChunkSize: 17,
      }))
    }
    for (const stage of ['force', 'step'] as const) {
      const results = []
      for (const backend of backends) results.push(await backend.measure(stage, 4))
      expect(differingBits(results[0].snapshot.forces, results[1].snapshot.forces)).toBe(0)
      expect(differingBits(results[0].snapshot.positions, results[1].snapshot.positions)).toBe(0)
      expect(results.every(result => ['valid', 'unavailable'].includes(result.timing.timerStatus))).toBe(true)
      for (const backend of backends) expect((await backend.read()).positions).toEqual(input.points)
    }
  } finally { backends.forEach(backend => backend.destroy()); device.destroy() }
}, 120000)
