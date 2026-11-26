import { expect, it } from 'vitest'
import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { deviceForTest } from '../../gpu/test-device'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { createFixture, nearLimit, PARAMETERS } from '../many-body/data'
import { compareArray, referenceTick } from '../many-body/reference'
import { strictExactShader } from './exact-shader'

// Compile and execute the actual production-routing composition on software as
// well as native adapters; the large combined tests are native-only.
for (const fixture of ['uniform', 'coincident', 'edge-cases'] as const) {
  it(`${fixture}: strict exact shader includes its arithmetic dependencies and matches the CPU force`, async context => {
    const device = await deviceForTest(); if (!device) { context.skip(); return }
    const owned: Array<{ destroy(): void }> = []
    const own = <T extends { destroy(): void }>(resource: T): T => { owned.push(resource); return resource }
    try {
      const input = createFixture(fixture, 65); const count = input.points.length / 4; const p = PARAMETERS
      const positions = own(upload(device, input.points)); const samples = own(upload(device, input.samples))
      const params = own(upload(device, new Float32Array([
        count, p.alpha, p.repulsion, nearLimit(count, p), p.friction, p.referenceLength, 0, 0,
      ]), Buffer.UNIFORM))
      const forces = own(device.createBuffer({ byteLength: input.points.byteLength, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
      const kernel = own(await Kernel.createAsync(device, {
        source: strictExactShader(),
        entryPoint: 'direct',
        shaderLayout: {
          bindings: bindingLayout([
            ['positions', 'read-only-storage'], ['samples', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
          ]),
        },
      }))
      const pass = device.beginComputePass()
      try { kernel.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, samples, params, forces } }) } finally { pass.end() }
      device.submit()
      const result = compareArray(await readFloats(forces), referenceTick(input, input.points, p).forces)
      expect(result.valid, JSON.stringify(result)).toBe(true)
    } finally { owned.reverse().forEach(resource => resource.destroy()); device.destroy() }
  })
}
