import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { differingBits } from '../combined-layout/resident'
import { buildReference, frameFor } from './data'
import { gridReference, comparePresent } from './reference'
import { createGridWebGPU } from './webgpu'
import { FORCE_VARIANTS, fastForceSource, isolatedForceSource } from './fast-force'

it('keeps diagnostic kernel sources distinct and uses the same force interface', () => {
  const corrected = fastForceSource('corrected')
  for (const variant of FORCE_VARIANTS) expect(fastForceSource(variant)).toContain('fn forceMain(')
  expect(fastForceSource('native-far')).toContain('farScratch[local] = pairVelocity(')
  expect(fastForceSource('native-near')).toContain('sum += pairVelocity(')
  expect(fastForceSource('factorized-both')).toContain('sum += factorizedPairVelocity(')
  expect(isolatedForceSource(corrected, 'far')).toContain('forces[targetIndex] = vec4(far, 0., 0.);')
  expect(isolatedForceSource(corrected, 'near')).not.toContain('velocity += farScratch[local]')
  expect(() => isolatedForceSource('invalid', 'far')).toThrow('anchors changed')
})

for (const [fixture, count] of [['edge-cases', 8], ['coincident', 129], ['uniform', 257], ['clusters', 513]] as Array<[Fixture, number]>) {
  it(`native arithmetic ${fixture} keeps finite outputs and discrete semantics`, async () => {
    const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
    const input = createFixture(fixture, count); const frame = frameFor(input.points, 0, 8, true)
    const structure = buildReference(input.points, frame); const expected = gridReference(input, input.points, PARAMETERS, frame, structure)
    const backends = []
    try {
      for (const variant of FORCE_VARIANTS) {
        const nativeFar = variant === 'native-far' || variant === 'native-both'
        const nativeNear = variant === 'native-near' || variant === 'native-both'
        const factorized = variant.startsWith('factorized')
        const far = factorized ? 'workgroup-factorized-far' : nativeFar ? 'workgroup-native-far' : 'workgroup-local'
        const near = variant === 'factorized-both' ? 'factorized' : nativeNear ? 'native' : 'refined'
        const backend = await createGridWebGPU(canvas, input, PARAMETERS, frame, far,
          factory => factory, { context: { device }, aggregation: 'cached-small', nearArithmetic: near })
        backends.push(backend); backend.step()
        const actual = await backend.read()
        if (variant === 'corrected') expect(comparePresent(actual, expected, input.points).valid).toBe(true)
        for (let i = 0; i < input.points.length; i += 4) {
          expect(actual.positions[i + 2]).toBe(input.points[i + 2]); expect(actual.positions[i + 3]).toBe(input.points[i + 3])
          if (input.points[i + 3] > 0.5 || input.points[i + 2] > 0.5) {
            expect(Object.is(actual.positions[i], input.points[i])).toBe(true)
            expect(Object.is(actual.positions[i + 1], input.points[i + 1])).toBe(true)
          } else {
            expect(Number.isFinite(actual.positions[i]) && Number.isFinite(actual.positions[i + 1])).toBe(true)
            expect(Number.isFinite(actual.forces[i]) && Number.isFinite(actual.forces[i + 1])).toBe(true)
          }
        }
        backend.setPositions(input.points); backend.step(); const repeated = await backend.read()
        expect(differingBits(actual.forces, repeated.forces)).toBe(0)
        expect(differingBits(actual.positions, repeated.positions)).toBe(0)
      }
    } finally { backends.forEach(backend => backend.destroy()); device.destroy() }
  }, 120000)
}
