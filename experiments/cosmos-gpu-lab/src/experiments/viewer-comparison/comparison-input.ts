import type { Graph } from '../../../../../dist/index.js'
import type { Input } from '../many-body/data'
import type { GraphInput } from '../weighted-links/data'

export const origin = 2048
export const seed = 29471

export type ComparisonInput = {
  scene: { input: Input; graph: GraphInput };
  positions: Float32Array;
  pinned: number[];
  size: number;
}

export function prepareComparisonInput (scene: ComparisonInput['scene'], size: number): ComparisonInput {
  const { input, graph } = scene
  const count = input.points.length / 4
  const positions = new Float32Array(count * 2)
  const pinned: number[] = []
  graph.sizes.fill(size)
  for (let i = 0; i < count; i++) {
    const offset = i * 4
    if (input.points[offset + 2]) pinned.push(i)
    const present = !input.points[offset + 3]
    for (let axis = 0; axis < 2; axis++) {
      const value = i * 2 + axis
      positions[value] = present ? input.points[offset + axis] + origin : NaN
      // Match the layout actually ingested by WebGL after Float32 rounding.
      if (present) input.points[offset + axis] = positions[value] - origin
    }
  }
  return { scene, positions, pinned, size }
}

export function applyComparisonInput (graph: Graph, { scene, positions, pinned }: ComparisonInput): void {
  graph.pause()
  graph.setPointPositions(positions, true)
  graph.setPinnedPoints(pinned)
  graph.setLinks(scene.graph.links)
  graph.setLinkStrength(scene.graph.weights)
}
