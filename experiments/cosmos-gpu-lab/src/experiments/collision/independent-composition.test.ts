import { expect, it } from 'vitest'
import { createOracle } from '../combined-layout/reference'
import { COLLISION } from './data'
import { parametersFor, sequence, createBackend } from './backend'
import { evaluate, sameBits } from './checks'
import { createCollisionSession } from './session'

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('compares collision arithmetic on the same cooled star tick, without replacing intermediates', async () => {
  const settings = {
    fixture: 'clusters' as const,
    count: 512,
    topology: 'star' as const,
    mode: 'combined' as const,
    evolution: 'independent' as const,
    arithmetic: 'native' as const,
    alpha: 1,
    coolingTicks: 300,
    collision: { ...COLLISION, iterations: 4 },
  }
  const session = await createCollisionSession(settings, () => document.createElement('canvas'))
  let start: Float32Array; let alpha: number
  try {
    expect(session.report.errors).toEqual({})
    for (let i = 0; i < 4; i++) await session.step()
    start = session.lanes.find(l => l.api === 'webgpu')!.positions.slice(); alpha = session.alpha()
  } finally { session.destroy() }
  // Freeze the native trajectory's input to tick 5. Starting a new strict
  // trajectory would compare different histories, rather than this error.
  for (const arithmetic of ['native', 'targeted', 'strict'] as const) {
    const parameters = parametersFor({ ...settings, arithmetic })
    const oracle = createOracle(session.graph, session.report.input.input, 'production', parameters)
    const stages = sequence(settings.mode, parameters)
    const b = await createBackend('webgpu', document.createElement('canvas'), session.graph, session.report.input.input, parameters)
    try {
      const result = await evaluate(b, oracle, stages, start, alpha)
      const repeated = await evaluate(b, oracle, stages, start, alpha)
      expect(sameBits(repeated.actual.positions, result.actual.positions)).toBe(true)
      expect(result.gate.stages.every(s => s.valid), JSON.stringify(result.gate)).toBe(true)
      if (arithmetic !== 'native') expect(result.gate.valid, JSON.stringify(result.gate)).toBe(true)
    } finally { b.destroy() }
  }
}, 120000)
