import { expect, it } from 'vitest'
import { createResidentComparison } from './resident'
for (const count of [128, 8192]) {
  for (const fixture of ['chain', 'communities', 'star', 'pinned'] as const) {
    it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${fixture} / ${count}: resident ticks match the reference with checkpoint-only reads`, async () => {
      const s = await createResidentComparison({ fixture, count, decay: 20, checkpointEvery: 5, springPrecision: 'trig' },
        () => document.createElement('canvas'))
      try {
        for (let tick = 1; tick <= 20; tick++) {
          const before = s.readbacks[1].snapshots
          const row = await s.step()
          s.render()
          if (row) expect(row.valid, JSON.stringify(row)).toBe(true)
          else expect(s.readbacks[1].snapshots).toBe(before)
        }
        expect(s.rows.map(r => r.tick)).toEqual([1, 5, 10, 15, 20])
        expect(s.readbacks.map(r => r.snapshots)).toEqual([25, 5])
        expect(s.readbacks.map(r => r.bytes)).toEqual([25 * count * 32, 5 * count * 32])
        await expect(s.step()).rejects.toThrow('unavailable')
      } finally { s.destroy(); s.destroy() }
    })
  }
}
