import type { Graph, GraphConfig } from '../../../../../dist/index.js'
import { isScaleCase, scaleConfig, scaleFixture } from './scale-fixture'

export const forces = {
  gravity: 'Gravity',
  center: 'Center',
  springs: 'Weighted springs',
  mouse: 'Pointer repulsion',
  attractors: 'Attractors',
  clusters: 'Clusters',
  repulsion: 'All-pairs repulsion',
  hierarchy: 'Hierarchical repulsion',
  combined: 'Springs, repulsion and collision',
  dense: 'Dense communities',
  hubs: 'Hub',
} as const

export type ForceCase = keyof typeof forces
export const forceCases = Object.keys(forces) as ForceCase[]
export const origin = 2048
export const viewport = { width: 288, height: 192 }
export const absentIndex = 6
export const hierarchyCount = 8192
export const pointer: [number, number] = [origin + 32, origin]

export const combinedPadding = 2
export const combinedDiameters = [16, 28, 18, 12, 16, 12, 14, 12] as const
export const combinedLinks = [0, 1, 1, 3, 3, 4, 0, 5, 3, 7] as const

const strength: Record<ForceCase, GraphConfig> = {
  dense: scaleConfig,
  hubs: scaleConfig,
  combined: {
    simulationLinkSpring: 0.5,
    simulationLinkDistance: 44,
    simulationLinkDistRandomVariationRange: [1, 1],
    simulationRepulsion: 12,
    simulationCollision: 1,
    simulationCollisionPadding: combinedPadding,
    simulationCollisionIterations: 2,
    simulationCollisionCooling: 0,
    linkDefaultColor: '#ffc76b',
    linkDefaultWidth: 4,
    linkDefaultArrows: false,
    linkOpacity: 1,
    linkVisibilityMinTransparency: 1,
  },
  gravity: { simulationGravity: 0.75 },
  center: { simulationCenter: 6 },
  springs: { simulationLinkSpring: 0.5, simulationLinkDistance: 14, simulationLinkDistRandomVariationRange: [1, 1] },
  mouse: { enableRightClickRepulsion: true, simulationRepulsionFromMouse: 4 },
  attractors: { simulationAttractor: 0.125 },
  clusters: { simulationCluster: 0.125 },
  repulsion: { simulationRepulsion: 12 },
  hierarchy: { simulationRepulsion: 0.25, simulationDecay: 32 },
}

export function forceConfig (fixture: ForceCase): GraphConfig {
  return {
    enableRenderLoop: false,
    enableZoom: false,
    enableDrag: false,
    fitViewOnInit: false,
    pixelRatio: 1,
    rescalePositions: false,
    randomSeed: 27931,
    transitionDuration: 0,
    backgroundColor: '#18202b',
    pointDefaultSize: fixture === 'hierarchy' ? 1.5 : 12,
    pointDefaultColor: '#7ad5e8',
    simulationGravity: 0,
    simulationCenter: 0,
    simulationLinkSpring: 0,
    simulationRepulsion: 0,
    simulationAttractor: 0,
    simulationCluster: 0,
    simulationCollision: 0,
    simulationRepulsionFromMouse: 0,
    simulationFriction: 1,
    ...strength[fixture],
  }
}

export function forcePositions (fixture: ForceCase): Float32Array {
  if (isScaleCase(fixture)) return scaleFixture(fixture).positions
  if (fixture === 'combined') {
    return Float32Array.from([-100, 56, -45, -32, -37, -36, 55, 0, 92, 34, 30, 58, NaN, NaN, 90, -58], v => v + origin)
  }
  if (fixture !== 'hierarchy') {
    return Float32Array.from([-50, 30, 40, 0, 20, 24, -40, -16, 8, -48, -20, 44, NaN, NaN, 24, 8], v => v + origin)
  }
  // An asymmetrical cloud with a denser left half, a reproducible subcell phase and a hole.
  const xy = new Float32Array(2 * hierarchyCount)
  for (let i = 0; i < hierarchyCount; i++) {
    const u = (i % 128 + ((i * 131) % 239) / 239) / 128
    const v = (Math.floor(i / 128) + ((i * 179) % 241) / 241) / 64
    xy[2 * i] = origin + (u * u - 0.4) * 144
    xy[2 * i + 1] = origin + (v - 0.5) * 96 + 5 * Math.sin(7 * u)
  }
  xy.set([NaN, NaN], 2 * absentIndex)
  return xy
}

export function loadForce (graph: Graph, fixture: ForceCase, dimensions = viewport): void {
  const xy = forcePositions(fixture)
  graph.setPointPositions(xy, true)
  if (isScaleCase(fixture)) {
    const scene = scaleFixture(fixture)
    graph.setPinnedPoints(scene.pinned)
    graph.setPointSizes(scene.sizes)
    graph.setPointColors(scene.colors)
    graph.setLinks(scene.links)
    graph.setLinkStrength(scene.weights)
    graph.setLinkColors(scene.linkColors)
    graph.setLinkWidths(scene.linkWidths)
  } else graph.setPinnedPoints([0])
  if (!isScaleCase(fixture) && fixture !== 'hierarchy') {
    const rgba = Float32Array.from({ length: xy.length * 2 }, (_, i) => (i < 4 ? [0.95, 0.42, 0.28, 1] : [0.47, 0.83, 0.91, 1])[i % 4])
    graph.setPointColors(rgba)
  }
  if (fixture === 'combined') {
    graph.setPointSizes(Float32Array.from(combinedDiameters))
    graph.setLinks(Float32Array.from(combinedLinks))
    graph.setLinkStrength(Float32Array.of(0.45, 1, 0.35, 0.8, 0.6))
  }
  if (fixture === 'springs') {
    graph.setLinks(new Float32Array([0, 1, 1, 2, 2, 4, 4, 6, 5, 7]))
    graph.setLinkStrength(new Float32Array([0.5, 0.25, 0, 1, 0.75]))
  }
  if (fixture === 'attractors') {
    const targets = Float32Array.from(xy, (v, i) => v + (i % 2 ? 16 : -24))
    targets.set([NaN, NaN], 6)
    graph.setPointAttractors(targets)
    graph.setPointAttractorStrength(new Float32Array([1, 1, 0.5, 1, 0, 1, 1, 0.25]))
  }
  if (fixture === 'clusters') {
    graph.setPointClusters([0, 0, 0, 1, 1, undefined, 0, 1])
    graph.setClusterPositions([undefined, undefined, origin + 16, origin + 32])
    graph.setPointClusterStrength(new Float32Array([1, 1, 0.5, 1, 0, 1, 1, 1]))
  }
  graph.render(1, 0)
  graph.pause()
  const { width, height } = dimensions
  const k = isScaleCase(fixture) ? Math.min(width, height) / 8000 : 1
  graph.setViewTransform({ k, x: (1 - k) * width / 2, y: (1 - k) * height / 2 }, [width, height])
}
