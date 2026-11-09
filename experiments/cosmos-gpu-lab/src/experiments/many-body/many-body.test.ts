import { describe, expect, it } from 'vitest'
import { deviceForTest } from '../../gpu/test-device'
import type { Backend } from './backend'
import { createFixture, FIXTURES, nearLimit, PARAMETERS, type Input, type Parameters } from './data'
import { compare, referenceTick } from './reference'
import { createWebGL } from './webgl'
import { createWebGPU } from './webgpu'

describe('Cosmos exact many-body reference', () => {
  it('matches an analytic far pair, includes pinned sources and excludes absent sources', () => {
    const p = { alpha: 1, repulsion: 1, friction: 1, referenceLength: 8 }
    const input = createFixture('pair', 2, p)
    expect(nearLimit(2, p)).toBe(2)
    const first = referenceTick(input, input.points, p)
    expect(Array.from(first.forces)).toEqual([-0.25, 0, 0, 0, 0.25, 0, 0, 0])
    expect(first.positions[0]).toBe(-2.25)
    input.points[2] = 1
    const pinned = referenceTick(input, input.points, p)
    expect(pinned.positions[0]).toBe(-2)
    expect(pinned.forces[4]).toBe(0.25)
    input.points[3] = 1
    const absent = referenceTick(input, input.points, p)
    expect(Array.from(absent.forces)).toEqual(Array(8).fill(0))
  })
  it('uses the production sub-unit falloff and near cap, with a zero-direction coincidence guard', () => {
    const p = { ...PARAMETERS, alpha: 1, friction: 1, referenceLength: 8 }
    const input = createFixture('pair', 2, p)
    input.points[0] = 0; input.points[4] = 0.25
    expect(referenceTick(input, input.points, p).forces[0]).toBe(-2)
    input.points[4] = 0
    expect(referenceTick(input, input.points, p).forces[0]).toBe(0)
    input.samples[0] = 1e-5
    expect(referenceTick(input, input.points, p).forces[0]).toBeCloseTo(2, 6)
  })
})

type Factory = (canvas: HTMLCanvasElement, input: Input, p: Parameters) => Promise<Backend>
const factories: Array<[string, Factory]> = [
  ['WebGL', createWebGL],
  ['WebGPU direct', (canvas, input, p): Promise<Backend> => createWebGPU(canvas, input, p, 'direct')],
  ['WebGPU tiled', (canvas, input, p): Promise<Backend> => createWebGPU(canvas, input, p, 'tiled')],
]
for (const [name, create] of factories) {
  describe(`${name}: production all-pairs semantics`, () => {
    for (const fixture of FIXTURES) {
      it(`${fixture}: force, integration, five independent ticks and reset`, async context => {
        if (name.startsWith('WebGPU')) {
          const probe = await deviceForTest(); probe?.destroy()
          if (!probe) { context.skip(); return }
        }
        const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340; document.body.append(canvas)
        const input = createFixture(fixture, 65)
        const backend = await create(canvas, input, PARAMETERS)
        try {
          let cpu = input.points
          let previousGpu = input.points
          for (let tick = 0; tick < 5; tick++) {
            const expected = referenceTick(input, cpu, PARAMETERS)
            backend.step()
            const actual = await backend.read()
            const local = compare(actual, referenceTick(input, previousGpu, PARAMETERS))
            const drift = compare(actual, expected)
            expect(local, `${fixture} tick ${tick}: same-input ${JSON.stringify(local)}, drift ${JSON.stringify(drift)}`).toMatchObject({ valid: true })
            if (fixture !== 'coincident') expect(drift, `${fixture} independent tick ${tick}`).toMatchObject({ valid: true })
            previousGpu = actual.positions
            cpu = expected.positions
          }
          backend.setPositions(input.points); backend.step()
          expect(compare(await backend.read(), referenceTick(input, input.points, PARAMETERS))).toMatchObject({ valid: true })
          backend.render([0, 0, 0.001, 0.001])
        } finally { backend.destroy(); canvas.remove() }
      })
    }
    it('enforces the production integration guard and matches a canonical evolved input', async context => {
      if (name.startsWith('WebGPU')) {
        const probe = await deviceForTest(); probe?.destroy()
        if (!probe) { context.skip(); return }
      }
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
      const input = createFixture('pair')
      const p = { ...PARAMETERS, repulsion: 1e6, referenceLength: 8 }
      const backend = await create(canvas, input, p)
      try {
        const expected = referenceTick(input, input.points, p)
        backend.step()
        const actual = await backend.read()
        expect(compare(actual, expected)).toMatchObject({ valid: true })
        expect(Math.abs(actual.positions[0] - input.points[0])).toBeCloseTo(8, 5)
        backend.setPositions(expected.positions); backend.step()
        expect(compare(await backend.read(), referenceTick(input, expected.positions, p))).toMatchObject({ valid: true })
      } finally { backend.destroy() }
    })

    it('covers empty inputs, workgroup tails and zero force', async context => {
      if (name.startsWith('WebGPU')) {
        const probe = await deviceForTest(); probe?.destroy()
        if (!probe) { context.skip(); return }
      }
      for (const count of [0, 1, 63, 64, 257, 258]) {
        const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
        const input = createFixture('uniform', count)
        const p = { ...PARAMETERS, alpha: count === 258 ? 0 : PARAMETERS.alpha }
        const backend = await create(canvas, input, p)
        try {
          backend.step()
          expect(compare(await backend.read(), referenceTick(input, input.points, p)), `count ${count}`).toMatchObject({ valid: true })
        } finally { backend.destroy() }
      }
    })
  })
}
