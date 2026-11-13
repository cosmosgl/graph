import { expect, it, vi } from 'vitest'
import { TOLERANCE, compareArray } from '../many-body/reference'
import { createOracle } from '../combined-layout/reference'
import { COLLISION, createFixture } from './data'
import { parametersFor, sequence } from './backend'
import { expectedTick, sameBits } from './checks'
import { createCollisionSession } from './session'
import { layoutMetrics } from './metrics'

it('keeps topology explicit and measures drift without changing numerical budgets', () => {
  const chain = createFixture('uniform', 32, 'chain').graph
  const star = createFixture('uniform', 32, 'star').graph
  const communities = createFixture('uniform', 32, 'communities').graph
  expect(chain.links.length).toBe(62); expect(communities.links.length).toBeGreaterThan(chain.links.length)
  expect(star.links.filter((_, i) => i % 2 === 0).every(n => n === 0)).toBe(true)
  const input = new Float32Array([0, 0, 0, 0, 2, 0, 1, 0, NaN, NaN, 0, 1])
  const shifted = input.slice(); shifted[0] += 0.5; shifted[4] += 0.5
  const metrics = layoutMetrics(shifted, input, input, [])
  expect(metrics.drift.rms).toBe(0.5); expect(metrics.alignedRms).toBe(0); expect(metrics.shape.finite).toBe(true)
  expect(compareArray(shifted, input, input).valid).toBe(false)
  expect(TOLERANCE).toEqual({ absolute: 2e-5, relative: 3e-5 })
})
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('independent ticks retain each lane, avoid reset uploads, and restore trajectory failure replays', async () => {
  const settings = {
    fixture: 'pair' as const,
    count: 2,
    mode: 'combined' as const,
    evolution: 'independent' as const,
    alpha: 1,
    collision: { ...COLLISION, iterations: 4 },
  }
  const session = await createCollisionSession(settings, () => document.createElement('canvas'))
  const parameters = parametersFor(settings); const oracle = createOracle(session.graph, session.report.input.input, 'production', parameters)
  const stages = sequence(settings.mode, parameters)
  try {
    expect(session.report.errors).toEqual({})
    // Deliberately separate one GPU lane, so resetting to CPU cannot masquerade
    // as an independent trajectory even on hardware where both paths agree.
    const gpu = session.lanes.find(l => l.api === 'webgpu')!
    const shifted = gpu.positions.slice(); shifted[0] += 32
    gpu.backend.setPositions(shifted); gpu.positions = shifted
    const uploads = session.lanes.map(l => vi.spyOn(l.backend, 'setPositions'))
    let cpu: Float32Array = session.cpu().slice()
    for (let i = 0; i < 5; i++) {
      const before = session.lanes.map(l => l.positions.slice())
      cpu = expectedTick(oracle, stages, cpu, settings.alpha).positions
      const predicted = expectedTick(oracle, stages, before[session.lanes.indexOf(gpu)], settings.alpha)
      await session.step()
      expect(session.cpu()).toEqual(cpu)
      expect(compareArray(gpu.positions, predicted.positions, shifted).valid).toBe(true)
      const row = session.report.rows.at(-1)!
      expect(row.complete).toBe(true)
      for (const lane of session.lanes) expect(row.trajectory[lane.api]).toEqual(compareArray(lane.positions, cpu, cpu))
      expect(row.metrics.webgpu!.drift.rms).toBeGreaterThan(0)
    }
    expect(uploads.every(spy => spy.mock.calls.length === 0)).toBe(true)
    expect(session.report.trajectoryFailures.webgpu!.tick).toBe(1)
    const saved = session.lanes.map(l => l.positions.slice()); const cpuSaved = session.cpu().slice()
    await session.replay()
    expect(session.report.replays.some(r => r.api === 'webgpu' && r.kind === 'trajectory' && r.reproduced && r.restored)).toBe(true)
    expect(session.cpu()).toEqual(cpuSaved)
    session.lanes.forEach((lane, i) => expect(sameBits(lane.positions, saved[i])).toBe(true))
    // Continue after replay: the live GPU positions, rather than replay output,
    // must still supply the next independent tick.
    const predicted = expectedTick(oracle, stages, gpu.positions, settings.alpha)
    await session.step(); expect(compareArray(gpu.positions, predicted.positions, shifted).valid).toBe(true)
    uploads.forEach(spy => spy.mockRestore())
  } finally { session.destroy() }
}, 120000)

for (const topology of ['chain', 'communities', 'star'] as const) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${topology}: independent collision composition retains all gates and mask checks`, async () => {
    const session = await createCollisionSession({
      fixture: 'masks',
      count: 8,
      topology,
      mode: 'combined',
      evolution: 'independent',
      alpha: 1,
      collision: { ...COLLISION, iterations: 4 },
    }, () => document.createElement('canvas'))
    try {
      expect(session.report.errors).toEqual({})
      for (let i = 0; i < 10; i++) await session.step()
      expect(session.report.rows.every(r => r.complete && r.metrics.cpu!.shape.finite && r.metrics.webgpu!.shape.finite)).toBe(true)
      expect(session.report.rows.every(r => r.checks.webgpu!.valid), JSON.stringify(session.report.rows.map(r => r.checks.webgpu))).toBe(true)
      for (const lane of session.lanes) {
        expect(sameBits((await lane.backend.read()).positions, lane.positions)).toBe(true)
        expect(lane.positions[0]).toBe(2048); expect(lane.positions[1]).toBe(2048)
        expect(Number.isNaN(lane.positions[8])).toBe(true); expect(lane.positions[11]).toBe(1)
      }
    } finally { session.destroy() }
  }, 120000)
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('cooled independent layouts replay captured alpha and stop without changing the trajectory', async () => {
  const settings = {
    fixture: 'pair' as const,
    count: 2,
    mode: 'combined' as const,
    evolution: 'independent' as const,
    alpha: 1,
    coolingTicks: 10,
    collision: { ...COLLISION, iterations: 4 },
  }
  const session = await createCollisionSession(settings, () => document.createElement('canvas'))
  const parameters = parametersFor(settings); const oracle = createOracle(session.graph, session.report.input.input, 'production', parameters)
  const stages = sequence(settings.mode, parameters)
  try {
    expect(session.report.errors).toEqual({}); await session.step()
    const gpu = session.lanes.find(l => l.api === 'webgpu')!
    const shifted = gpu.positions.slice(); shifted[0] += 32; gpu.backend.setPositions(shifted); gpu.positions = shifted
    for (let tick = 2; tick <= 10; tick++) {
      const alpha = session.alpha(); const expected = expectedTick(oracle, stages, session.cpu(), alpha)
      await session.step(); expect(session.report.rows.at(-1)!.alpha).toBe(alpha); expect(session.cpu()).toEqual(expected.positions)
    }
    expect(session.alpha()).toBeCloseTo(0.001, 12)
    const capture = session.report.trajectoryFailures.webgpu!
    expect(capture.tick).toBe(2); expect(capture.alpha).toBeCloseTo(Math.pow(0.001, 1 / 10), 12)
    const cpu = session.cpu().slice(); const saved = session.lanes.map(l => l.positions.slice()); const alpha = session.alpha()
    await session.replay()
    expect(session.report.replays.filter(r => r.kind === 'trajectory').every(r => r.reproduced && r.restored)).toBe(true)
    expect(session.alpha()).toBe(alpha); expect(session.cpu()).toEqual(cpu)
    for (const [i, lane] of session.lanes.entries()) expect(sameBits((await lane.backend.read()).positions, saved[i])).toBe(true)
    await expect(session.step()).rejects.toThrow('Cooling schedule finished')
    expect(session.cpu()).toEqual(cpu); expect(session.report.rows).toHaveLength(10)
  } finally { session.destroy() }
}, 120000)
