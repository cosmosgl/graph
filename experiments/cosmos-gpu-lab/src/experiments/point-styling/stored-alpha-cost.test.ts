import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { DEFAULTS, point } from './data'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { measureStoredAlphaCase, runStoredAlphaCost, summarizeStoredAlphaCost, STORED_ALPHA_COST_POLICY, type StoredAlphaCostRow } from './stored-alpha-cost'

declare module 'vitest' { interface TaskMeta { storedAlphaCost?: StoredAlphaCostRow[] } }
for (const [lane, create] of [['webgl', createStylingWebGL], ['webgpu', createStylingWebGPU]] as const) {
  it(`${lane}: times only non-audited stored-alpha requests and preserves exact outputs`, async ({ task }) => {
    const backend = await create(document.createElement('canvas'), undefined, true)
    try {
      const row = (await measureStoredAlphaCase(backend, lane, 16, true, () => false, 2))!
      expect(row.valid).toBe(true); expect(row.passes).toBe(49)
      expect(row.normal).toHaveLength(2); expect(row.profiled).toHaveLength(2)
      for (const sample of [...row.normal, ...row.profiled]) {
        expect(sample.setupCpuMs).toBeGreaterThanOrEqual(0)
        expect(sample.completionWallMs).toBeGreaterThanOrEqual(sample.encodeSubmitCpuMs)
        expect(sample.frameReadbackWallMs).toBeGreaterThanOrEqual(0)
        expect(sample.scratchBytes).toBe(512 * 320 * 8)
        if (sample.gpuMs !== null) {
          expect(sample.timerStatus).toBe('valid')
          expect(sample.gpuMs).toBeLessThanOrEqual(sample.completionWallMs)
          expect(Object.values(sample.stageGpuMs!).reduce((sum, n) => sum + n, 0)).toBeCloseTo(sample.gpuMs, 8)
        } else expect(sample.stageGpuMs).toBeNull()
      }
      expect(row.normal.every(s => s.gpuMs === null)).toBe(true)
      expect(summarizeStoredAlphaCost(row).completion).toBeGreaterThanOrEqual(0)
      task.meta.storedAlphaCost = [row]
      await expect(backend.render([point(256, 160)], DEFAULTS, false, 'explicit', false,
        { region: STORED_ALPHA_COST_POLICY.region, audit: true, measure: 'gpu' })).rejects.toThrow('audit readbacks')
      expect(await measureStoredAlphaCase(backend, lane, 16, false, () => true, 1)).toBeUndefined()
    } finally { backend.destroy() }
  }, 120000)
}
const sweep = it.skipIf(!import.meta.env.LAB_STORED_ALPHA_SWEEP || !import.meta.env.LAB_NATIVE_GPU)
sweep('records the full bounded native stored-alpha cost sweep', async ({ task }) => {
  const rows: StoredAlphaCostRow[] = []; task.meta.storedAlphaCost = rows
  await runStoredAlphaCost(async row => {
    rows.push(row)
    await writeArtifact(`stored-alpha-${row.lane}-${row.count}-${row.overlapping}`, row)
    // eslint-disable-next-line no-console
    console.info('Stored-alpha cost', JSON.stringify({
      count: row.count,
      overlapping: row.overlapping,
      lane: row.lane,
      ...summarizeStoredAlphaCost(row),
    }))
  }, () => false)
  expect(rows).toHaveLength(16)
  expect(rows.every(row => row.valid)).toBe(true)
}, 600000)
