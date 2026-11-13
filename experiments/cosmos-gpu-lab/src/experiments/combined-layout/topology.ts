import type { Device } from '@luma.gl/core'
import { upload } from '../../gpu/luma'
import { resourceScope, type BufferLedger } from '../../gpu/resource-scope'
import { buildTopology, type GraphInput } from '../weighted-links/data'
export type LinkInput = Pick<GraphInput, 'links' | 'weights' | 'sizes'>

// A replacement owns its complete buffer bundle. Allocate before swapping it in;
// the position buffers, kernels and device belong to the surrounding backend.
export function createLinkResources (device: Device, points: Float32Array, input: LinkInput, ledger?: BufferLedger, hubThreshold?: number): {
  links: ReturnType<typeof upload>; sizes: ReturnType<typeof upload>;
  offsets: Array<ReturnType<typeof upload>>; edges: Array<ReturnType<typeof upload>>;
  edgeCount: number; bytes: number; buildMs: number;
  hubs?: Array<ReturnType<typeof upload>>; readonly hubCounts: number[];
  destroy(): void; update(points: Float32Array, input: LinkInput): void;
} {
  const pack = (points: Float32Array, input: LinkInput): {
    topology: ReturnType<typeof buildTopology>; edges: Uint8Array[]; hubs: Uint32Array[];
  } => {
    if (input.sizes.length !== points.length / 4 || input.links.length % 2 || input.weights.length !== input.links.length / 2) {
      throw new Error('Invalid topology array lengths')
    }
    const topology = buildTopology({ points, links: input.links, weights: input.weights, sizes: input.sizes })
    const edges = topology.directions.map(d => {
      const data = new ArrayBuffer(d.neighbors.length * 16); const ints = new Uint32Array(data); const floats = new Float32Array(data)
      for (let i = 0; i < d.neighbors.length; i++) { ints[i * 4] = d.neighbors[i]; floats.set(d.properties.subarray(i * 4, i * 4 + 3), i * 4 + 1) }
      return new Uint8Array(data)
    })
    const hubs = hubThreshold === undefined
      ? []
      : topology.directions.map(d =>
        Uint32Array.from(Array.from({ length: points.length / 4 }, (_, i) => i).filter(i => d.offsets[i + 1] - d.offsets[i] >= hubThreshold)))
    return { topology, edges, hubs }
  }
  const initial = pack(points, input); const topology = initial.topology
  const owned: Array<ReturnType<typeof upload>> = []
  const scope = resourceScope(ledger)
  const keep = <T extends ReturnType<typeof upload>>(buffer: T): T => { owned.push(buffer); return scope.own(buffer) }
  try {
    const links = keep(upload(device, topology.links)); const sizes = keep(upload(device, input.sizes))
    const offsets = topology.directions.map(d => keep(upload(device, d.offsets)))
    const edges = initial.edges.map(data => keep(upload(device, data)))
    const hubs = hubThreshold === undefined
      ? undefined
      : initial.hubs.map(data => {
        const buffer = keep(upload(device, new Uint32Array(points.length / 4)))
        if (data.byteLength) buffer.write(data)
        return buffer
      })
    let hubCounts = initial.hubs.map(h => h.length)
    let edgeCount = topology.links.length / 2; let buildMs = topology.buildMs
    return {
      links,
      sizes,
      offsets,
      edges,
      hubs,
      get hubCounts (): number[] { return hubCounts },
      get edgeCount (): number { return edgeCount },
      bytes: owned.reduce((sum, buffer) => sum + buffer.byteLength, 0),
      get buildMs (): number { return buildMs },
      update (points, input): void {
        // Prepare and check every range before any buffer write.
        const next = pack(points, input)
        const writes = [
          { buffer: links, data: next.topology.links }, { buffer: sizes, data: input.sizes },
          ...offsets.map((buffer, i) => ({ buffer, data: next.topology.directions[i].offsets })),
          ...edges.map((buffer, i) => ({ buffer, data: next.edges[i] })),
          ...(hubs ?? []).map((buffer, i) => ({ buffer, data: next.hubs[i] })),
        ]
        if (writes.some(w => w.data.byteLength > w.buffer.byteLength)) throw new Error('Topology capacity exceeded')
        for (const { buffer, data } of writes) if (data.byteLength) buffer.write(data)
        edgeCount = next.topology.links.length / 2; buildMs = next.topology.buildMs; hubCounts = next.hubs.map(h => h.length)
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
