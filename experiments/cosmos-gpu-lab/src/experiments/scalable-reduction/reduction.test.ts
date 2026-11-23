import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { createScalableReductionBackend } from './backend'
import { calculateInitialCpuCenter, rotateCpuCenter } from './reference'

// One float32 epsilon in clip space for this bounded fixture and one rotation.
const centerErrorBudget = 2 ** -23

it.each([65_537, 10_000_000])('reduces all %i resident points before and after a rotation', async pointCount => {
  const errors: string[] = []
  const backend = await createScalableReductionBackend(document.createElement('canvas'), pointCount, error => { errors.push(error.message) })
  const rows = []
  try {
    const initial = calculateInitialCpuCenter(pointCount)
    for (const [tick, expected] of [initial, rotateCpuCenter(initial)].entries()) {
      if (tick === 1) {
        const resident = await backend.run(true, false)
        expect(resident.center).toBeUndefined()
      }
      const { center } = await backend.run(false, true)
      if (!center) throw new Error('Missing center readback')
      const error = Math.hypot(center.x - expected.x, center.y - expected.y)
      rows.push({ tick, center, expected, error })
      expect(center.count).toBe(pointCount)
      expect(error).toBeLessThanOrEqual(centerErrorBudget)
    }
  } finally {
    try {
      await backend.waitForIdle()
    } catch (error) {
      errors.push(`Waiting for GPU completion: ${String(error)}`)
    }
    backend.destroy()
    await writeArtifact(`scalable-reduction-${pointCount}`, {
      device: backend.info, browser: navigator.userAgent, pointCount, centerErrorBudget, rows, errors,
    })
  }
  expect(errors).toEqual([])
})
