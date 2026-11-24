import type { GraphConfig } from '../../../../../dist/index.js'
import { denseFixtureParameters } from '../million-graph/dense-communities'
import { createInteractiveFixture, type InteractiveFixture, type InteractiveFixtureKind } from '../million-graph/interactive-fixtures'

export type ScaleCase = InteractiveFixtureKind
export function isScaleCase (fixture: string): fixture is ScaleCase { return fixture === 'dense' || fixture === 'hubs' }

const worldOrigin = 4096
const restLength = 14
const padding = 0.5
const palette = [
  [90, 192, 219], [167, 146, 232], [232, 148, 183], [229, 165, 107],
  [179, 199, 106], [96, 193, 155], [115, 160, 229], [205, 160, 214],
]

export const scaleConfig: GraphConfig = {
  spaceSize: 2 * worldOrigin,
  simulationRepulsion: 0.5,
  simulationLinkSpring: 0.45,
  simulationLinkDistance: restLength,
  simulationLinkDistRandomVariationRange: [1, 1],
  simulationCollision: 1,
  simulationCollisionIterations: 1,
  simulationCollisionPadding: padding,
  simulationCollisionCooling: 0,
  simulationDecay: 5000,
  simulationFriction: 0.85,
  linkDefaultArrows: false,
  linkVisibilityMinTransparency: 1,
  linkOpacity: 1,
}

export type ScaleFixture = {
  positions: Float32Array;
  links: Float32Array;
  weights: Float32Array;
  sizes: Float32Array;
  colors: Float32Array;
  linkColors: Float32Array;
  linkWidths: Float32Array;
  pinned: number[];
  communities: Int8Array;
  communityCenters: [number, number][];
  metadata: InteractiveFixture['metadata'];
  firstAnchor: number;
  worldOrigin: number;
  restLength: number;
  padding: number;
  neighborhoodRadius: number;
}

function makeFixture (kind: ScaleCase): ScaleFixture {
  const { input, graph, metadata } = createInteractiveFixture(8192, kind)
  const { communityCount, circleRadius, neighborhoodRadius } = denseFixtureParameters
  const { pointCount, linkCount } = metadata
  const anchorCount = metadata.pinnedCount - 1
  const firstAnchor = pointCount - anchorCount
  const communityCenters: [number, number][] = Array.from({ length: communityCount }, (_, i) => {
    const angle = 2 * Math.PI * i / communityCount
    return [worldOrigin + circleRadius * Math.cos(angle), worldOrigin + circleRadius * Math.sin(angle)]
  })
  const positions = new Float32Array(pointCount * 2)
  const communities = new Int8Array(pointCount).fill(-1)
  const colors = new Float32Array(pointCount * 4)
  const pinned: number[] = []
  const { links, weights, sizes } = graph
  for (let id = 0; id < pointCount; id++) {
    const offset = 4 * id
    if (input.points[offset + 2]) pinned.push(id)
    const absent = input.points[offset + 3] !== 0
    positions[2 * id] = absent ? NaN : worldOrigin + input.points[offset]
    positions[2 * id + 1] = absent ? NaN : worldOrigin + input.points[offset + 1]
    if (id >= 2) communities[id] = (id < firstAnchor ? (id - 2) % anchorCount : id - firstAnchor) % communityCount
    const rgb = id === 0 ? [242, 107, 71] : palette[Math.max(0, communities[id])]
    colors.set([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1], offset)
    sizes[id] = 2 + (id % 4) * 0.5
  }
  sizes[0] = 9
  // Expose one real incident link in the empty area between communities. Its
  // existing free endpoint moves under the same forces as every other leaf.
  const leaf = links[3]
  positions.set([worldOrigin + 1040, worldOrigin - 1220], 2 * leaf)
  sizes[leaf] = 6
  const linkColors = new Float32Array(linkCount * 4)
  const linkWidths = new Float32Array(linkCount).fill(1)
  for (let i = 0; i < linkCount; i++) {
    weights[i] = 0.4 + (i % 5) * 0.15
    linkColors.set([0.38, 0.49, 0.57, 1], 4 * i)
  }
  linkColors.set([1, 199 / 255, 107 / 255, 1], 4)
  linkWidths[1] = 3
  return {
    positions,
    links,
    weights,
    sizes,
    colors,
    linkColors,
    linkWidths,
    pinned,
    communities,
    communityCenters,
    metadata,
    firstAnchor,
    worldOrigin,
    restLength,
    padding,
    neighborhoodRadius,
  }
}

const fixtures = new Map<ScaleCase, ScaleFixture>()

/** Both isolated Graph packages receive the same typed arrays in the same order. */
export function scaleFixture (kind: ScaleCase): ScaleFixture {
  let scene = fixtures.get(kind)
  if (!scene) {
    scene = makeFixture(kind)
    fixtures.set(kind, scene)
  }
  return scene
}
