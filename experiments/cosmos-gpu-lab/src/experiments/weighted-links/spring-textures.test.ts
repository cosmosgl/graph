import { expect, it } from 'vitest'
import { forceFrag } from '../../../../../src/modules/ForceLink/force-spring'
import { buildTopology, createFixture } from './data'
import { springTextureLayout, uploadSpringTextures } from './spring-textures'

it('binds exactly the imported production spring samplers across the packing transition', () => {
  const source = forceFrag(3)
  const graph = createFixture('edge-cases'); const before = buildTopology(graph)
  for (const direction of before.directions) {
    const original = direction.properties.slice()
    const uploads = uploadSpringTextures(direction, 3, 3, (_size, data) => data)
    for (const name of Object.keys(uploads)) expect(source).toContain(`uniform sampler2D ${name};`)
    expect(uploads.linkRandomDistanceTexture.filter((_v, i) => i % 4 === 0)).toEqual(original.filter((_v, i) => i % 4 === 2))
    expect(direction.properties).toEqual(original)
    expect(Object.keys(uploads)).toHaveLength(springTextureLayout(source) === 'packed' ? 2 : 3)
  }
})
it('rejects incomplete or ambiguous production texture contracts instead of drawing unbound inputs', () => {
  const packed = 'uniform sampler2D linkNeighborAndSpringTexture;'
  const legacy = 'uniform sampler2D linkIndicesTexture; uniform sampler2D linkPropertiesTexture;'
  expect(springTextureLayout(packed)).toBe('packed'); expect(springTextureLayout(legacy)).toBe('separate')
  for (const source of ['', 'uniform sampler2D linkIndicesTexture;', packed + legacy]) {
    expect(() => springTextureLayout(source)).toThrow('Unsupported production spring texture contract')
  }
})
