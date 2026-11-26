import type { Graph, GraphConfig } from '../../../../../dist/index.js'
import type { ScaleFixture } from './scale-fixture'

export const composedConfig: GraphConfig = {
  simulationDecay: 100,
  simulationGravity: 0.125,
  simulationCenter: 0.75,
  simulationCluster: 0.1,
  simulationAttractor: 0.1,
  enableRightClickRepulsion: true,
  simulationRepulsionFromMouse: 12,
}

export function composedChannels (fixture: ScaleFixture): {
  memberships: Int32Array; targets: Float32Array; clusterStrengths: Float32Array; attractors: Float32Array; attractorStrengths: Float32Array;
} {
  const count = fixture.metadata.pointCount
  const memberships = new Int32Array(count).fill(-1)
  const targets = new Float32Array(fixture.communityCenters.length * 2).fill(NaN)
  const clusterStrengths = new Float32Array(count)
  const attractors = new Float32Array(2 * count).fill(NaN)
  const attractorStrengths = new Float32Array(count)
  for (const [group, [cx, cy]] of fixture.communityCenters.entries()) {
    if (group % 2 === 0) targets.set([cx + 48, cy - 32], group * 2)
  }
  for (let i = 2; i < count; i++) {
    const group = fixture.communities[i]
    if (i % 13 !== 0) {
      memberships[i] = group
      clusterStrengths[i] = i % 3 === 0 ? 0.5 : 1
    }
    if (i % 5 === 0) {
      const [cx, cy] = fixture.communityCenters[group]
      attractors[2 * i] = cx - 32
      attractors[2 * i + 1] = cy + 48
      attractorStrengths[i] = i % 15 === 0 ? -0.25 : 0.5
    }
  }
  return { memberships, targets, clusterStrengths, attractors, attractorStrengths }
}

export function loadComposedChannels (graph: Graph, channels: ReturnType<typeof composedChannels>): void {
  graph.setPointClusters(Array.from(channels.memberships, group => group < 0 ? undefined : group))
  graph.setClusterPositions(Array.from(channels.targets, value => Number.isNaN(value) ? undefined : value))
  graph.setPointClusterStrength(channels.clusterStrengths)
  graph.setPointAttractors(channels.attractors)
  graph.setPointAttractorStrength(channels.attractorStrengths)
}
