import { createDenseCommunities, denseFixtureParameters, type DenseCommunities } from './dense-communities'

export type InteractiveFixtureKind = 'dense' | 'hubs'
export type InteractiveFixture = Pick<DenseCommunities, 'input' | 'graph'> & {
  metadata: {
    kind: InteractiveFixtureKind;
    pointCount: number;
    linkCount: number;
    largestIncomingDegree: number;
    hubId: number;
    hubPinned: boolean;
    pinnedCount: number;
    absentCount: number;
  };
}

const hubDegreeLimit = 8192

export function createInteractiveFixture (count: number, kind: InteractiveFixtureKind): InteractiveFixture {
  const { input, graph, firstAnchor, anchorCount } = createDenseCommunities(count)
  // The isolated pin gives the moving study a known target. The absent point
  // occupies the same position so each pick also exercises the absent mask.
  input.points.set([0, 0, 1, 0, 0, 0, 0, 1])

  if (kind === 'hubs') {
    const hub = graph.links[1]
    const community = (graph.links[0] - firstAnchor) % denseFixtureParameters.communityCount
    let redirected = 0
    // The first leaf stays attached to its anchor and becomes the unpinned
    // hub. Redirect the source of other leaves in its community, preserving
    // link count, target order and the anchor-to-anchor links.
    for (let edge = 1; edge < firstAnchor - 2 && redirected < hubDegreeLimit; edge++) {
      const offset = edge * 2
      const anchor = graph.links[offset] - firstAnchor
      if (anchor % denseFixtureParameters.communityCount !== community) continue
      graph.links[offset] = hub
      redirected++
    }
  }

  // Cosmos's incoming spring stage groups links by source.
  const incoming = new Uint32Array(count)
  let hubId = 0
  for (let offset = 0; offset < graph.links.length; offset += 2) {
    const source = graph.links[offset]
    incoming[source]++
    if (incoming[source] > incoming[hubId]) hubId = source
  }

  return {
    input,
    graph,
    metadata: {
      kind,
      pointCount: count,
      linkCount: graph.links.length / 2,
      largestIncomingDegree: incoming[hubId],
      hubId,
      hubPinned: input.points[hubId * 4 + 2] === 1,
      pinnedCount: anchorCount + 1,
      absentCount: 1,
    },
  }
}
