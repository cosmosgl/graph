import { beforeAll, expect, it } from 'vitest'
import { createOracle } from '../combined-layout/reference'
import { COLLISION, COLLISION_ARITHMETICS } from './data'
import { parametersFor, sequence, createBackend } from './backend'
import { evaluate } from './checks'
import { createCollisionSession, type CollisionSession } from './session'
const settings = {
  fixture: 'clusters' as const,
  count: 512,
  topology: 'star' as const,
  mode: 'combined' as const,
  evolution: 'independent' as const,
  alpha: 1,
  coolingTicks: 300,
  arithmetic: 'native' as const,
  collision: { ...COLLISION, iterations: 4 },
}
let fixture: CollisionSession; let start: Float32Array; let alpha: number
beforeAll(async () => {
  if (!import.meta.env.LAB_NATIVE_GPU) return
  fixture = await createCollisionSession(settings, () => document.createElement('canvas'))
  try {
    expect(fixture.report.errors).toEqual({})
    for (let i = 0; i < 4; i++) await fixture.step()
    start = fixture.lanes.find(l => l.api === 'webgpu')!.positions.slice(); alpha = fixture.alpha()
  } finally { fixture.destroy() }
})
for (const arithmetic of COLLISION_ARITHMETICS) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`cooled star candidate: ${arithmetic}`, async () => {
    const parameters = parametersFor({ ...settings, arithmetic })
    const oracle = createOracle(fixture.graph, fixture.report.input.input, 'production', parameters)
    const b = await createBackend('webgpu', document.createElement('canvas'), fixture.graph, fixture.report.input.input, parameters)
    try {
      const result = await evaluate(b, oracle, sequence(settings.mode, parameters), start, alpha)
      expect(result.gate.stages.every(s => s.valid), JSON.stringify(result.gate)).toBe(true)
      if (arithmetic === 'targeted' || arithmetic === 'strict') expect(result.gate.valid, JSON.stringify(result.gate)).toBe(true)
    } finally { b.destroy() }
  }, 120000)
}
