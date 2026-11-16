import { expect, it } from 'vitest'
import { compareArray } from '../many-body/reference'
import { createFixture } from '../weighted-links/data'
import { createOracle } from './reference'
import { forceSettings } from './production-settings'
import { createCombinedWebGL } from './webgl'

// Unlike the whole-layout tests, assert WebGL's force and integration values
// explicitly. Both directional uploads must match the independent CPU oracle.
for (const fixture of ['pair', 'chain', 'star', 'edge-cases'] as const) {
  it(`WebGL ${fixture}: preserves directional spring inputs and integration`, async () => {
    const graph = createFixture(fixture, 65)
    const input = { points: graph.points, samples: new Float32Array(graph.points.length / 2) }
    const settings = forceSettings('varied32', graph.points.length / 4)
    const oracle = createOracle(graph, input, 'hierarchical', settings)
    const backend = await createCombinedWebGL(document.createElement('canvas'), graph, input, { forceSettings: settings })
    try {
      let cpu = graph.points
      for (let tick = 0; tick < 3; tick++) {
        for (const stage of ['incoming', 'outgoing'] as const) {
          const expected = oracle.stage(stage, cpu, 0.6, tick)
          backend.stepStage(stage, 0.6)
          const actual = await backend.read()
          expect(compareArray(actual.forces, expected.forces), `${stage} force at tick ${tick}`).toMatchObject({ valid: true })
          expect(compareArray(actual.positions, expected.positions), `${stage} integration at tick ${tick}`).toMatchObject({ valid: true })
          cpu = expected.positions
        }
      }
    } finally { backend.destroy() }
  })
}
