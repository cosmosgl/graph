import { expect, it } from 'vitest'
import { validateGravityTrig } from './gravity-trig-validation'
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('refined gravity trigonometry matches independent normal inputs and signed axes', async () => {
  const result = await validateGravityTrig()
  expect(result.cases).toBe(8198)
  expect(result.differing, JSON.stringify(result.examples)).toEqual([0, 0, 0])
})
