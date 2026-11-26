import type { Graph } from '../../../../../dist/index.js'

export const collisionViewport = { width: 256, height: 192 }
export const collisionCenter = 2048
export const pinned = 0
export const isolated = 5
export const absent = 6
export type CollisionFixture = 'contacts' | 'hashed'

export const positions = [
  2004, 2057, 2021, 2065, 2039, 2046, 2065, 2029, 2082, 2040,
  2108, 2089, NaN, NaN,
] as const
export const sizes = [42, 30, 24, 36, 26, 20, 24] as const
export const colors = [
  [244, 118, 95], [251, 202, 84], [119, 197, 127], [80, 188, 224],
  [152, 135, 227], [235, 156, 203], [255, 255, 255],
] as const

export const collisionConfig = {
  enableRenderLoop: false,
  enableZoom: false,
  fitViewOnInit: false,
  initialZoomLevel: 1,
  pixelRatio: 1,
  rescalePositions: false,
  randomSeed: 29471,
  transitionDuration: 0,
  backgroundColor: '#18202b',
  simulationGravity: 0,
  simulationCenter: 0,
  simulationRepulsion: 0,
  simulationRepulsionFromMouse: 0,
  simulationLinkSpring: 0,
  simulationAttractor: 0,
  simulationCluster: 0,
  simulationCollision: 1,
  simulationCollisionPadding: 3,
  simulationCollisionIterations: 2,
  simulationCollisionCooling: 0,
}

/** The hashed fixture adds a stationary grid beyond the viewport to cross the 4096-slot threshold. */
export function collisionInput (fixture: CollisionFixture): { xy: Float32Array; diameters: Float32Array; rgba: Float32Array } {
  const count = fixture === 'hashed' ? 4097 : sizes.length
  const xy = new Float32Array(count * 2)
  xy.set(positions)
  const diameters = new Float32Array(count).fill(8)
  diameters.set(sizes)
  const rgba = new Float32Array(count * 4).fill(1)
  rgba.set(colors.flatMap(([r, g, b]) => [r / 255, g / 255, b / 255, 1]))
  for (let id = sizes.length; id < count; id++) {
    const site = id - sizes.length
    xy[id * 2] = 64 + (site % 64) * 24
    xy[id * 2 + 1] = 64 + Math.floor(site / 64) * 24
  }
  return { xy, diameters, rgba }
}

/** Both packages receive their own copy of every input and run this same application. */
export function loadCollision (graph: Graph, fixture: CollisionFixture = 'contacts'): void {
  const { xy, diameters, rgba } = collisionInput(fixture)
  graph.setPointPositions(xy, true)
  graph.setPointSizes(diameters)
  graph.setPointColors(rgba)
  graph.setPinnedPoints([pinned])
  graph.render(1, 0)
  graph.pause()
  graph.setZoomTransformByPointPositions(new Float32Array([collisionCenter, collisionCenter]), 0, 1, 0, false)
}
