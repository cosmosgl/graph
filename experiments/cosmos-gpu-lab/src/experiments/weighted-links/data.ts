export type Fixture = 'pair' | 'chain' | 'star' | 'clusters' | 'hubs' | 'edge-cases'
export const FIXTURES: Fixture[] = ['pair', 'chain', 'star', 'clusters', 'hubs', 'edge-cases']
export type GraphInput = {
  // vec4: x, y, pinned, absent. Positions remain resident throughout a tick.
  points: Float32Array;
  links: Float32Array;
  weights: Float32Array;
  sizes: Float32Array;
}
export type Parameters = {
  spring: number; distance: number; variation: [number, number]; alpha: number;
  friction: number; maxStep: number; collision: boolean; radius: number; padding: number;
}
export const PARAMETERS: Parameters = {
  spring: 0.3,
  distance: 0.15,
  variation: [0.8, 1.2],
  alpha: 0.6,
  friction: 0.85,
  maxStep: 2,
  collision: false,
  radius: 0,
  padding: 0.01,
}
export type Adjacency = { offsets: Uint32Array; neighbors: Uint32Array; edgeIds: Uint32Array; properties: Float32Array; maxDegree: number }
export type Topology = { directions: [Adjacency, Adjacency]; links: Uint32Array; maxDegree: number; buildMs: number }
export function validIndex (value: number, count: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < count
}
// Shared random samples isolate the port from PRNG/upload-order differences. Each direction gets its own sample.
export function distanceSample (edge: number, direction: number): number {
  let x = Math.imul(edge + 1, 1664525) ^ Math.imul(direction + 7, 1013904223)
  x ^= x >>> 16
  return Math.fround((x >>> 0) / 4294967296)
}
export function buildTopology (graph: GraphInput): Topology {
  const started = performance.now()
  const n = graph.points.length / 4
  const degree = new Uint32Array(n)
  const ids: number[] = []
  const links: number[] = []
  for (let e = 0; e < graph.links.length / 2; e++) {
    const a = graph.links[e * 2]; const b = graph.links[e * 2 + 1]
    if (!validIndex(a, n) || !validIndex(b, n)) continue
    degree[a]++; degree[b]++; ids.push(e); links.push(a, b)
  }
  const directions = [0, 1].map(direction => {
    const offsets = new Uint32Array(n + 1)
    for (const e of ids) offsets[graph.links[e * 2 + direction] + 1]++
    for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i]
    const cursor = offsets.slice()
    const neighbors = new Uint32Array(ids.length)
    const edgeIds = new Uint32Array(ids.length)
    const properties = new Float32Array(ids.length * 4)
    for (const e of ids) {
      const self = graph.links[e * 2 + direction]; const other = graph.links[e * 2 + 1 - direction]
      const slot = cursor[self]++
      neighbors[slot] = other; edgeIds[slot] = e
      const weight = graph.weights[e]
      const strength = Number.isFinite(weight) && weight >= 0 ? weight : 1 / Math.max(Math.min(degree[self], degree[other]), 1)
      properties.set([degree[other] / (degree[self] + degree[other]), Math.sqrt(strength), distanceSample(e, direction), 0], slot * 4)
    }
    let maxDegree = 0
    for (let i = 0; i < n; i++) maxDegree = Math.max(maxDegree, offsets[i + 1] - offsets[i])
    return { offsets, neighbors, edgeIds, properties, maxDegree }
  }) as [Adjacency, Adjacency]
  return { directions, links: new Uint32Array(links), maxDegree: degree.reduce((a, b) => Math.max(a, b), 0), buildMs: performance.now() - started }
}
export function createFixture (fixture: Fixture, requestedCount = 128, changed = false): GraphInput {
  const n = fixture === 'pair' ? 2 : fixture === 'edge-cases' ? 8 : Math.max(4, requestedCount)
  const points = new Float32Array(n * 4)
  const sizes = new Float32Array(n).fill(0.04)
  for (let i = 0; i < n; i++) {
    const angle = i * 2.399963229728653
    const radius = 0.15 + 0.65 * Math.sqrt(i / n)
    points.set([Math.cos(angle) * radius, Math.sin(angle) * radius, 0, 0], i * 4)
  }
  const edges: number[] = []
  const add = (a: number, b: number): void => { edges.push(a, b) }
  if (fixture === 'pair') { points.set([-0.6, 0, 0, 0, 0.6, 0, 0, 0]); add(0, 1) } else if (fixture === 'edge-cases') {
    sizes[0] = 0.3; sizes[1] = 0.5 // Make the collision rest-length floor active, not merely enabled.
    add(0, 1); add(0, 1); add(1, 0); add(1, 1); add(2, 3); add(4, 5)
    add(6, 7); add(-1, 0); add(1.5, 2); add(0, 99)
    points[2] = 1; points[5 * 4 + 3] = 1
    points[3 * 4] = points[2 * 4]; points[3 * 4 + 1] = points[2 * 4 + 1]
  } else {
    for (let i = 1; i < n; i++) {
      if (fixture === 'chain') add(i - 1, i)
      if (fixture === 'star') add(0, i)
      if (fixture === 'hubs') { add(0, i); if (i > 3) add(1 + i % 3, i) }
      if (fixture === 'clusters' && i % 16 !== 0) { add(i - 1, i); add(Math.floor(i / 16) * 16, i) }
    }
  }
  if (changed) {
    // Same point space; change edge count and direction, requiring new CSR offsets/capacity.
    edges.splice(0, Math.min(6, edges.length))
    for (let i = 1; i < n; i += 3) add(i, n - 1)
  }
  const weights = Float32Array.from({ length: edges.length / 2 }, (_, e) => [0, 0.25, 1, 4, NaN, -1][e % 6])
  if (fixture === 'pair') weights.fill(1)
  return { points, links: new Float32Array(edges), weights, sizes }
}
