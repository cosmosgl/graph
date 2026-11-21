import { Buffer } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { createDevice, readFloats, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { compareArray } from '../many-body/reference'
import { buildReference, cellOf, frameSamples, layout } from './data'
import { gridReference } from './reference'
import { compareStructure } from './validation'
import { createResidentHierarchy } from './resident-hierarchy'

for (const [fixture, requested] of [['edge-cases', 8], ['coincident', 257], ['uniform', 513], ['clusters', 513]] as Array<[Fixture, number]>) {
  it(`GPU resident hierarchy handles ${fixture}`, async () => {
    const input = createFixture(fixture, requested); const count = input.points.length / 4
    const device = await createDevice('webgpu'); const scope = resourceScope(); const own = scope.own
    try {
      const positions = own(upload(device, input.points)); const samples = own(upload(device, input.samples))
      const forces = own(device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
      const grid = own(await createResidentHierarchy(device, [positions], samples, forces, count, PARAMETERS))
      grid.prepare(0, PARAMETERS.alpha); grid.encodeIndex(0)
      const pass = device.beginComputePass(); try { grid.encodeForce(pass, 0) } finally { pass.end() }
      device.submit(); await waitForGpu(device)
      const [box, actual, index, output] = await Promise.all([grid.readBounds(), grid.readStructure(), grid.readIndex(), readFloats(forces)])
      const frame = { bounds: box, slots: 8, precise: false, seed: frameSamples(0).seed }
      const reference = buildReference(input.points, frame); const comparison = compareStructure(actual, reference)
      expect(comparison.slotMismatches, JSON.stringify(comparison)).toBe(0)
      expect(comparison.maxHashError).toBeLessThanOrEqual(2e-7)
      for (let i = 2; i < actual.aggregates.length; i += 4) expect(actual.aggregates[i]).toBe(reference.aggregates[i])
      const n = layout(count).finest; const seen = new Uint8Array(count)
      for (let cell = 0; cell < n * n; cell++) {
        for (let cursor = index.offsets[cell]; cursor < index.offsets[cell + 1]; cursor++) {
          const i = index.pointIndices[cursor]; expect(i).toBeLessThan(count); seen[i]++
          const expectedCell = input.points[i * 4 + 3] > 0.5 ? 0 : cellOf(input.points[i * 4], input.points[i * 4 + 1], n, box)
          expect(cell).toBe(expectedCell)
        }
      }
      expect(seen.every(value => value === 1)).toBe(true)
      const expected = gridReference(input, input.points, PARAMETERS, frame, actual)
      const check = compareArray(output, expected.forces)
      expect(check.valid, JSON.stringify(check)).toBe(true)
      expect(output.every(Number.isFinite)).toBe(true)
    } finally { scope.destroy(); device.destroy() }
  }, 120000)
}
