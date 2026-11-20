import { workload } from '../../integrated-webgpu/data'
import { createInteractiveFixture } from '../../million-graph/interactive-fixtures'
import { loadYoutubeFixture } from '../../million-graph/youtube-fixture'
import type { Pair } from '../../selection/reference'

export const viewport = { width: 961, height: 541, pixelRatio: 2 }
const workloads = ['karate', 'dense', 'hubs', 'youtube'] as const
export type Workload = typeof workloads[number]
export const origin = 2048
export const seed = 29471

export async function prepareFixture (workloadName: Workload, points: number): Promise<{
  scene: Awaited<ReturnType<typeof loadYoutubeFixture>>;
  replacement: Awaited<ReturnType<typeof loadYoutubeFixture>>;
  positions: Float32Array;
  replacementPositions: Float32Array;
  pinned: number[];
  size: number;
  zoom: number;
  digest: string;
  pickIndices: number[];
}> {
  const scene = workloadName === 'karate'
    ? workload('karate', 34)
    : workloadName === 'youtube' ? await loadYoutubeFixture(points) : createInteractiveFixture(points, workloadName)
  const { input, graph } = scene
  const count = input.points.length / 4
  const size = workloadName === 'youtube' ? 2 : 4
  graph.sizes.fill(size)
  const positions = new Float32Array(count * 2)
  const replacementPositions = new Float32Array(count * 2)
  const shifted = input.points.slice()
  const pinned: number[] = []
  for (let i = 0; i < count; i++) {
    const offset = i * 4
    if (input.points[offset + 2]) pinned.push(i)
    for (let axis = 0; axis < 2; axis++) {
      const present = !input.points[offset + 3]
      positions[i * 2 + axis] = present ? input.points[offset + axis] + origin : NaN
      // Use the actual Float32 layout ingested by WebGL, translated back to
      // the candidate's zero-centered space. Avoid an origin-rounding mismatch.
      if (present) input.points[offset + axis] = positions[i * 2 + axis] - origin
      const delta = axis === 0 ? 1 : -1
      replacementPositions[i * 2 + axis] = positions[i * 2 + axis] + delta
      if (present) shifted[offset + axis] = replacementPositions[i * 2 + axis] - origin
    }
  }
  const reversed = graph.links.slice()
  const weights = graph.weights.slice().reverse()
  for (let i = 0; i < weights.length; i++) {
    const source = reversed.length - (i + 1) * 2
    reversed[i * 2] = graph.links[source + 1]; reversed[i * 2 + 1] = graph.links[source]
  }
  const replacement = { input: { ...input, points: shifted }, graph: { ...graph, points: shifted, links: reversed, weights } }
  const hashInputs = [positions, input.points, graph.links, graph.weights, graph.sizes, shifted, reversed, weights]
  const hashes = await Promise.all(hashInputs.map(async array => Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', array as Float32Array<ArrayBuffer>)), value => value.toString(16).padStart(2, '0')
  ).join('')))
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashes.join(' ')))
  const digest = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
  const zoom = workloadName === 'dense' || workloadName === 'hubs' ? 0.07 : workloadName === 'youtube' ? 0.25 : 3
  const pickIndices = workloadName === 'dense' || workloadName === 'hubs' ? [0] : workloadName === 'youtube' ? [count - 12, count - 7, count - 2] : [0, 3, 8]
  return { scene, replacement, positions, replacementPositions, pinned, size, zoom, digest, pickIndices }
}

export type BenchmarkFixture = Awaited<ReturnType<typeof prepareFixture>>
export const rectangle: [Pair, Pair] = [[viewport.width * 0.12, viewport.height * 0.1], [viewport.width * 0.88, viewport.height * 0.9]]
export const polygon: Pair[] = [[90, 250], [355, 30], [895, 210], [840, 495], [320, 505]]
