import { describe, expect, it } from 'vitest'
import { deviceForTest } from '../../gpu/test-device'
import { buildTopology, createFixture, FIXTURES, PARAMETERS } from './data'
import { compare, referenceTick } from './reference'
import { createWebGLBackend } from './webgl'
import { createWebGPUBackend } from './webgpu'

describe('weighted link topology and semantics', () => {
  it('preserves duplicates, self-loops, edge IDs and stable directional order; skips invalid endpoints', () => {
    const graph = createFixture('edge-cases'); const t = buildTopology(graph)
    expect(t.links.length).toBe(14)
    expect(Array.from(t.directions[0].edgeIds.slice(0, 4))).toEqual([0, 1, 2, 3])
    expect(Array.from(t.directions[0].neighbors.slice(0, 4))).toEqual([1, 1, 0, 1])
    expect(t.directions[0].properties[1]).toBe(0)
    expect(t.directions[0].properties[5]).toBe(0.5)
    expect(t.directions[0].properties[17]).toBe(1)
    expect(t.directions[0].offsets[8]).toBe(7)
  })
  it('bounds each directional program independently, including reversed stars and no links', () => {
    const graph = createFixture('star', 100000)
    const maxima = (): number[] => buildTopology(graph).directions.map(direction => direction.maxDegree)
    expect(maxima()).toEqual([99999, 1])
    for (let i = 0; i < graph.links.length; i += 2) {
      const source = graph.links[i]; graph.links[i] = graph.links[i + 1]; graph.links[i + 1] = source
    }
    expect(maxima()).toEqual([1, 99999])
    graph.links = new Float32Array()
    expect(maxima()).toEqual([0, 0])
  })
  it('integrates between directions rather than summing forces on the same positions', () => {
    const g = createFixture('pair')
    const p = { ...PARAMETERS, spring: 1, alpha: 1, friction: 1, distance: 0.2, variation: [1, 1] as [number, number] }
    const r = referenceTick(g, g.points, p)
    expect(r.firstForce[0]).toBeCloseTo(0.5, 6)
    expect(r.intermediate[0]).toBeCloseTo(-0.1, 6)
    expect(r.secondForce[4]).toBeCloseTo(-0.25, 6)
    expect(r.positions[4]).toBeCloseTo(0.35, 6)
  })
  it('resolves missing weights and applies the contact-distance floor', () => {
    const graph = createFixture('pair')
    graph.weights = new Float32Array()
    graph.sizes.fill(0.8)
    expect(buildTopology(graph).directions[0].properties[1]).toBe(1)
    const plain = referenceTick(graph, graph.points, PARAMETERS)
    const floored = referenceTick(graph, graph.points, { ...PARAMETERS, collision: true })
    expect(floored.firstForce[0]).toBeLessThan(plain.firstForce[0])
    expect(floored.firstForce[0]).toBeGreaterThan(0)
  })
})

for (const [name, create] of [['WebGL', createWebGLBackend], ['WebGPU', createWebGPUBackend]] as const) {
  describe(`${name} Cosmos spring comparison`, () => {
    for (const fixture of FIXTURES) {
      it(`${fixture}: matches both forces and substeps, reset and topology replacement`, async context => {
        const probe = name === 'WebGPU' ? await deviceForTest() : undefined
        probe?.destroy()
        if (name === 'WebGPU' && !probe) {
          if (import.meta.env.REQUIRE_WEBGPU) throw new Error('WebGPU required')
          context.skip(); return
        }
        const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340; document.body.append(canvas)
        const backend = await create(canvas)
        try {
          for (const changed of [false, true]) {
            const graph = createFixture(fixture, fixture === 'hubs' ? 1025 : 65, changed)
            const params = { ...PARAMETERS, collision: fixture === 'edge-cases' }
            backend.setGraph(graph, buildTopology(graph), params)
            let cpu = graph.points
            for (let tick = 0; tick < 5; tick++) {
              const expected = referenceTick(graph, cpu, params)
              backend.step(tick === 0)
              const actual = await backend.read()
              expect(compare(actual, expected), `tick ${tick} changed ${changed}`).toMatchObject({ valid: true, failures: 0 })
              cpu = expected.positions
            }
            backend.reset(); backend.step()
            expect(compare(await backend.read(), referenceTick(graph, graph.points, params))).toMatchObject({ valid: true })
            if (fixture === 'pair' && !changed) {
              for (const stage of ['force', 'tick'] as const) {
                const sample = await backend.measure(stage)
                expect(sample.completionMs).toBeGreaterThanOrEqual(sample.submitMs)
                expect(sample.completionMs).toBeGreaterThanOrEqual(0)
                if (sample.gpuMs !== null) expect(sample.gpuMs).toBeGreaterThanOrEqual(0)
              }
            }
          }
        } finally { backend.destroy(); canvas.remove() }
      })
    }
    it('handles no links, same-device capacity growth, and finite oversized spring steps', async context => {
      const probe = name === 'WebGPU' ? await deviceForTest() : undefined
      probe?.destroy()
      if (name === 'WebGPU' && !probe) {
        if (import.meta.env.REQUIRE_WEBGPU) throw new Error('WebGPU required')
        context.skip(); return
      }
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340; document.body.append(canvas)
      const backend = await create(canvas)
      try {
        const empty = createFixture('chain', 4); empty.links = new Float32Array(); empty.weights = new Float32Array()
        backend.setGraph(empty, buildTopology(empty), PARAMETERS); backend.step()
        expect(compare(await backend.read(), referenceTick(empty, empty.points, PARAMETERS)).valid).toBe(true)
        const large = createFixture('star', 257)
        const params = { ...PARAMETERS, spring: 100, maxStep: 0.1 }
        backend.setGraph(large, buildTopology(large), params); backend.step()
        expect(compare(await backend.read(), referenceTick(large, large.points, params)).valid).toBe(true)
      } finally { backend.destroy(); canvas.remove() }
    })
  })
}
