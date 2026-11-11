import { expect, it, vi } from 'vitest'
import { compareArray } from '../many-body/reference'
import { createGridStudy } from './grid-study'
import * as gpu from './webgpu'
vi.mock('./webgpu', { spy: true })

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('finds the first faulty tick inside a sparse checkpoint interval and exports its input', async () => {
  const real = (await vi.importActual<typeof gpu>('./webgpu')).createCombinedWebGPU
  let created = 0
  vi.mocked(gpu.createCombinedWebGPU).mockImplementation(async (...args) => {
    const b = await real(...args); const step = b.stepTick!; const corrupt = created++ % 2 === 1
    return {
      ...b,
      stepTick (alpha: number, tick: number): void {
        step(alpha, tick)
        // Deterministic candidate fault between checkpoints. Replaying from the
        // last trusted GPU input must locate it, without a CPU position reset.
        if (corrupt && tick === 2) b.patchPositions!(2, new Float32Array([10000, 10000, 0, 0]))
      },
    }
  })
  const s = await createGridStudy(document.createElement('canvas'), { warmups: 0, samples: 4, frames: 1 }, 'layout-acceptance')
  try {
    await s.run([{
      count: 128,
      fixture: 'chain',
      distribution: 'uniform',
      historyTicks: 20,
      decay: 100,
      checkpointEvery: 10,
      preset: 'varied32',
      candidate: 'cached-small',
      repulsionPolicy: 'production',
    }], { cancelled: () => false, progress: () => {} })
    const r = s.report; const row = r.rows[0]
    expect(r.status).toBe('failed'); expect(row.trials).toHaveLength(0)
    expect(row.replay).toEqual({ fromTick: 1, throughTick: 9, firstFailureTick: 3, reproduced: true })
    expect(r.failure?.tick).toBe(2); expect(r.failure?.tickInput).toHaveLength(128 * 4)
    expect(r.failure?.samples).toBe(32); expect(row.cleanup).toEqual([0, 0])
    expect(compareArray(new Float32Array(r.failure!.actual.positions), new Float32Array(r.failure!.expected.positions)).valid).toBe(false)
  } finally { s.destroy(); vi.mocked(gpu.createCombinedWebGPU).mockRestore() }
})
