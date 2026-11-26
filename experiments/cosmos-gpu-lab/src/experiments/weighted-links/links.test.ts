import { describe, expect, it } from 'vitest'
import { buildTopology, createFixture } from './data'
import { springTextureLayout } from './spring-textures'

describe('weighted link topology and semantics', () => {
  it('recognizes both spring texture layouts regardless of sampler precision', () => {
    for (const qualifier of ['', 'lowp ', 'mediump ', 'highp ']) {
      const sampler = `uniform ${qualifier}sampler2D`
      const packed = `${sampler} linkNeighborAndSpringTexture;`
      const indices = `${sampler} linkIndicesTexture;`
      const properties = `${sampler} linkPropertiesTexture;`
      expect(springTextureLayout(packed)).toBe('packed')
      expect(springTextureLayout(`${indices}\n${properties}`)).toBe('separate')
      expect(() => springTextureLayout(indices)).toThrow('Unsupported production spring texture contract')
      expect(() => springTextureLayout(`${packed}\n${indices}`)).toThrow('Unsupported production spring texture contract')
    }
  })

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
})
