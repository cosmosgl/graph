import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { buildReference, frameFor } from './data'
import { comparePresent, gridReference } from './reference'
import { compareStructure } from './validation'
import { createGridWebGPU } from './webgpu'

for (const [fixture, count, precise] of [
  ['edge-cases', 8, true],
  ['uniform', 65, false],
  ['uniform', 257, true],
  ['coincident', 129, true],
  ['clusters', 513, true],
] as Array<[Fixture, number, boolean]>) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`direct/workgroup ${fixture}/${count} preserve small-case semantics`, async () => {
    const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
    const input = createFixture(fixture, count); const frame = frameFor(input.points, 0, 8, precise)
    const structure = buildReference(input.points, frame); const expected = gridReference(input, input.points, PARAMETERS, frame, structure)
    const backends = []
    try {
      for (const mode of ['streamed', 'refined', 'workgroup', 'workgroup-local'] as const) {
        backends.push(await createGridWebGPU(canvas, input, PARAMETERS, frame, mode, factory => factory, { context: { device } }))
      }
      for (const backend of backends) {
        backend.step()
        const snapshot = await backend.read(); const actualStructure = await backend.readStructure()
        expect(compareStructure(actualStructure, structure).valid).toBe(true)
        expect(comparePresent(snapshot, expected, input.points).valid).toBe(true)
      }
    } finally { backends.forEach(backend => backend.destroy()); device.destroy() }
  }, 120000)
}
