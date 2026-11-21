import { forceFrag } from '../../../../../src/modules/ForceLink/force-spring'
import type { Adjacency } from './data'

// The lab imports production GLSL, including main's changes in a PR merge.
// Keep uploads compatible with both sides of the texture-packing transition;
// an unknown contract must fail here, not silently sample an unbound texture.
export function springTextureLayout (source: string): 'packed' | 'separate' {
  const declares = (name: string): boolean => new RegExp(`uniform\\s+sampler2D\\s+${name}\\s*;`).test(source)
  const packed = declares('linkNeighborAndSpringTexture')
  const indices = declares('linkIndicesTexture'); const properties = declares('linkPropertiesTexture')
  if (packed && !indices && !properties) return 'packed'
  if (!packed && indices && properties) return 'separate'
  throw new Error('Unsupported production spring texture contract')
}
const layout = springTextureLayout(forceFrag(0))

export function uploadSpringTextures<T> (
  direction: Adjacency, pointSize: number, linkSize: number, texture: (size: number, data: Float32Array) => T
): Record<string, T> {
  const neighbors = new Float32Array(direction.neighbors.length * 4)
  const random = new Float32Array(neighbors.length)
  const properties = layout === 'separate' ? new Float32Array(neighbors.length) : undefined
  for (let i = 0; i < direction.neighbors.length; i++) {
    const offset = i * 4
    neighbors[offset] = direction.neighbors[i] % pointSize
    neighbors[offset + 1] = Math.floor(direction.neighbors[i] / pointSize)
    // Already resolved and rounded by topology: bias, sqrt(strength), random.
    const destination = properties ?? neighbors; const channel = properties ? 0 : 2
    destination[offset + channel] = direction.properties[offset]
    destination[offset + channel + 1] = direction.properties[offset + 1]
    random[offset] = direction.properties[offset + 2]
  }
  return {
    ...(properties
      ? {
        linkIndicesTexture: texture(linkSize, neighbors),
        linkPropertiesTexture: texture(linkSize, properties),
      }
      : { linkNeighborAndSpringTexture: texture(linkSize, neighbors) }),
    // The shader reads R only; retain the existing RGBA upload and samples.
    linkRandomDistanceTexture: texture(linkSize, random),
  }
}
