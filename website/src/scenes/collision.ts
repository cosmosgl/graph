import { getRgbaColor } from '@cosmos.gl/graph'
import { storyUrl } from '../site-urls'
import { studyPalette } from './palette'
import type { GeneratedSceneDefinition } from './types'

const POINTS = 50000
const SEED_RADIUS = 1.5
const MIN_POINT_SIZE = 2
const BASE_MAX_POINT_SIZE = 17
const MAX_POINT_SIZE = BASE_MAX_POINT_SIZE * 1.5
const LARGE_POINT_QUANTILE = 0.9
const collisionPalette = studyPalette.slice(6, 10).reverse()

/** The performance story's crowded disc, resolved by live GPU collisions. */
export const collisionStress: GeneratedSceneDefinition = {
  id: 'collision-stress-test',
  title: 'Point Collisions',
  description: 'A dense disc of 50,000 points keeps the GPU collision force busy. ' +
    'Gentle gravity compresses the disc while five collision passes per tick separate overlapping points.',
  pointCount: POINTS,
  linkCount: 0,
  initialZoomFactor: window.matchMedia('(max-width: 700px)').matches ? 2 : 0.85,
  warmupSteps: 0,
  background: '#111318',
  source: {
    label: 'Example: collision stress test ↗',
    url: storyUrl('examples-performance--collision-stress-test'),
  },
  simulation: {
    randomSeed: 42,
    simulationCollision: 0.25,
    simulationCollisionPadding: 1,
    simulationCollisionIterations: 5,
    simulationCollisionRadius: undefined,
    simulationRepulsion: 0,
    simulationGravity: 0.001,
    simulationDecay: 100000,
    simulationFriction: 0.85,
    enableDrag: true,
    scalePointsOnZoom: true,
    renderLinks: false,
    showFPSMonitor: true,
  },
  create: (random) => {
    const positions = new Float32Array(POINTS * 2)
    const colors = new Float32Array(POINTS * 4)
    const sizes = new Float32Array(POINTS)
    const palette = collisionPalette.map(color => getRgbaColor(color))

    for (let i = 0; i < POINTS; i++) {
      const angle = random() * Math.PI * 2
      // Uniform area density matches the original 1500-world-unit seed disc.
      const area = random()
      const radius = Math.sqrt(area) * SEED_RADIUS
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      positions[i * 2] = x
      positions[i * 2 + 1] = y
      const sizeSample = random()
      const baseSize = MIN_POINT_SIZE + sizeSample * (BASE_MAX_POINT_SIZE - MIN_POINT_SIZE)
      // Expand the largest tenth so the smaller points keep their original sizes.
      const largePointFraction = Math.max(0, (sizeSample - LARGE_POINT_QUANTILE) / (1 - LARGE_POINT_QUANTILE))
      sizes[i] = baseSize + largePointFraction * (MAX_POINT_SIZE - BASE_MAX_POINT_SIZE)
      // Warped waves form irregular patches. The cutoffs give each shade about a quarter of the disc.
      const field = Math.sin(4.8 * x + 2.3 * Math.sin(2.9 * y - 1.2 * x)) +
        0.7 * Math.sin(5.4 * y - 2.5 * x + 0.8 * Math.cos(4.1 * x + 1.9 * y)) +
        0.34 * Math.sin(9.2 * x + 8.1 * y)
      const colorIndex = Number(field >= -0.7) + Number(field >= -0.03) + Number(field >= 0.62)
      colors.set(palette[colorIndex]!, i * 4)
    }

    return { positions, colors, sizes }
  },
}
