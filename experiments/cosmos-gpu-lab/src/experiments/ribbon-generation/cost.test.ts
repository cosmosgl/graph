import { it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { createDevice, describeDevice } from '../../gpu/luma'
import { DEFAULTS } from '../curved-links/data'
import { makeScene } from './data'
import { runStudy, assessment, type Report } from './study'

// Explicit opt-in: local measurements are ignored artifacts, never timing assertions.
// Run with LAB_RIBBON_COST=1 LAB_NATIVE_GPU=1 ... test:gpu .../cost.test.ts
it.runIf(import.meta.env.LAB_RIBBON_COST)('records the bounded cost screen on the selected adapter', async () => {
  const device = await createDevice('webgpu')
  const rows: Array<Omit<Report, 'baseline' | 'candidate'> & { assessment: string }> = []
  try {
    for (const repeat of [0, 1]) {
      for (const [count, segments, picking, distribution] of [
        [1000, 19, false, 'short'], [10000, 19, false, 'short'], [10000, 19, true, 'short'],
        [10000, 3, false, 'short'], [10000, 19, false, 'overlap'], [100000, 19, false, 'short'],
      ] as const) {
        const report = await runStudy(device, makeScene(count, distribution), { ...DEFAULTS, segments }, picking, () => false, () => {}, distribution)
        const data = { ...report, baseline: undefined, candidate: undefined }
        rows.push({ ...data, assessment: assessment(report) })
      }
      // Keep each complete repetition even if a later device failure interrupts.
      await writeArtifact(`ribbon-cost-${repeat}`, { device: describeDevice(device), repeat, rows })
    }
  } finally { device.destroy() }
}, 180000)
