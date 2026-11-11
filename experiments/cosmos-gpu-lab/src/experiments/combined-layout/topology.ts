import type { Device } from '@luma.gl/core'
import { upload } from '../../gpu/luma'
import { buildTopology, type GraphInput } from '../weighted-links/data'
export type LinkInput = Pick<GraphInput, 'links' | 'weights' | 'sizes'>

// A replacement owns its complete buffer bundle. Allocate before swapping it in;
// the position buffers, kernels and device belong to the surrounding backend.
export function createLinkResources (device: Device, points: Float32Array, input: LinkInput): {
  links: ReturnType<typeof upload>; sizes: ReturnType<typeof upload>;
  offsets: Array<ReturnType<typeof upload>>; edges: Array<ReturnType<typeof upload>>;
  edgeCount: number; bytes: number; buildMs: number; destroy(): void;
} {
  if (input.sizes.length !== points.length / 4 || input.links.length % 2 || input.weights.length !== input.links.length / 2) {
    throw new Error('Invalid topology array lengths; point count must stay fixed')
  }
  const topology = buildTopology({ points, links: input.links, weights: input.weights, sizes: input.sizes })
  const owned: Array<ReturnType<typeof upload>> = []
  const keep = <T extends ReturnType<typeof upload>>(buffer: T): T => { owned.push(buffer); return buffer }
  try {
    const links = keep(upload(device, topology.links)); const sizes = keep(upload(device, input.sizes))
    const offsets = topology.directions.map(d => keep(upload(device, d.offsets)))
    const edges = topology.directions.map(d => {
      const data = new ArrayBuffer(d.neighbors.length * 16); const ints = new Uint32Array(data); const floats = new Float32Array(data)
      for (let i = 0; i < d.neighbors.length; i++) { ints[i * 4] = d.neighbors[i]; floats.set(d.properties.subarray(i * 4, i * 4 + 3), i * 4 + 1) }
      return keep(upload(device, new Uint8Array(data)))
    })
    return {
      links,
      sizes,
      offsets,
      edges,
      edgeCount: topology.links.length / 2,
      bytes: owned.reduce((sum, buffer) => sum + buffer.byteLength, 0),
      buildMs: topology.buildMs,
      destroy (): void { owned.reverse().forEach(buffer => buffer.destroy()) },
    }
  } catch (error) { owned.reverse().forEach(buffer => buffer.destroy()); throw error }
}
