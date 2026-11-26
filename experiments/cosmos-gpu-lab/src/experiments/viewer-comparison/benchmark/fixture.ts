import { workload } from '../../integrated-webgpu/data'
import { createInteractiveFixture } from '../../million-graph/interactive-fixtures'
import { loadYoutubeFixture } from '../../million-graph/youtube-fixture'
import type { Pair } from '../../selection/reference'
import { origin, prepareComparisonInput, type ComparisonInput } from '../comparison-input'

export { origin, seed } from '../comparison-input'

export const viewport = { width: 961, height: 541, pixelRatio: 2 }
const workloads = ['karate', 'dense', 'hubs', 'youtube'] as const
export type Workload = typeof workloads[number]

export async function prepareFixture (workloadName: Workload, points: number): Promise<ComparisonInput & {
  replacement: Awaited<ReturnType<typeof loadYoutubeFixture>>;
  replacementPositions: Float32Array;
  zoom: number;
  digest: string;
  pickIndices: number[];
}> {
  const interactive = workloadName === 'dense' || workloadName === 'hubs'
    ? createInteractiveFixture(points, workloadName)
    : undefined
  const scene = interactive ?? (workloadName === 'karate' ? workload('karate', 34) : await loadYoutubeFixture(points))
  const { input, graph } = scene
  if (workloadName === 'hubs' && points === 1_000_000) {
    const hub = interactive?.metadata.hubId ?? -1
    let sourceDegree = 0
    for (let i = 0; i < graph.links.length; i += 2) {
      if (graph.links[i] === hub) sourceDegree++
    }
    if (sourceDegree !== 8192 || input.points[hub * 4 + 2] !== 0 || input.points[hub * 4 + 3] !== 0) {
      throw new Error(`The million-point hub fixture requires a present, unpinned hub with 8,192 source-grouped links (found ${sourceDegree})`)
    }
  }
  const count = input.points.length / 4
  const size = workloadName === 'youtube' ? 2 : 4
  const comparison = prepareComparisonInput(scene, size)
  const { positions } = comparison
  const replacementPositions = new Float32Array(count * 2)
  const shifted = input.points.slice()
  for (let i = 0; i < count; i++) {
    const offset = i * 4
    const present = !input.points[offset + 3]
    for (let axis = 0; axis < 2; axis++) {
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
  return { ...comparison, replacement, replacementPositions, zoom, digest, pickIndices }
}

export type BenchmarkFixture = Awaited<ReturnType<typeof prepareFixture>>
export const rectangle: [Pair, Pair] = [[viewport.width * 0.12, viewport.height * 0.1], [viewport.width * 0.88, viewport.height * 0.9]]
export const polygon: Pair[] = [[90, 250], [355, 30], [895, 210], [840, 495], [320, 505]]
