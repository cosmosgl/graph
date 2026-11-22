import { getRgbaColor } from '@cosmos.gl/graph'
import { interpolateWarm } from 'd3-scale-chromatic'
import { storyUrl } from '../site-urls'
import type { GeneratedSceneDefinition } from './types'

const COLUMNS = 100
const ROWS = 100
const POINTS = COLUMNS * ROWS
const LINKS = ROWS * (COLUMNS - 1) + COLUMNS * (ROWS - 1)
const COLOR_PERIOD = 1000

/** The Storybook Worm's topology, forces and per-tick color shift, on the website background. */
export const worm: GeneratedSceneDefinition = {
  id: 'worm',
  title: 'Force-Directed Grid',
  description: 'Springs connect neighboring points in a 100 × 100 grid. ' +
    'As repulsion spreads the points apart, a moving color gradient traces the folds of the mesh.',
  pointCount: POINTS,
  linkCount: LINKS,
  initialZoomFactor: 2,
  background: '#111318',
  source: { label: 'Storybook: Worm ↗', url: storyUrl('examples-showcase--worm') },
  simulation: {
    randomSeed: 42,
    simulationGravity: 0.5,
    simulationRepulsion: 1,
    simulationLinkSpring: 1,
    simulationLinkDistance: 1,
    simulationFriction: 0.7,
    simulationDecay: 10000000,
    pointDefaultSize: 3,
    pointOpacity: 0.7,
    pointGreyoutOpacity: 0.1,
    linkDefaultWidth: 0.8,
    linkGreyoutOpacity: 0,
    curvedLinks: true,
    linkBlending: true,
    renderLinks: true,
  },
  create: (random) => {
    const positions = new Float32Array(POINTS * 2)
    const colors = new Float32Array(POINTS * 4)
    const sizes = new Float32Array(POINTS).fill(3)
    const links = new Float32Array(LINKS * 2)
    const linkColors = new Float32Array(LINKS * 4)
    const linkWidths = new Float32Array(LINKS).fill(0.8)
    const pointClusters: number[] = []
    const palette = new Float32Array(COLOR_PERIOD * 4)

    // generateMeshData(100, 100, 1000, 1) uses this exact sequential color domain.
    for (let i = 0; i < COLOR_PERIOD; i++) {
      const color = getRgbaColor(interpolateWarm(i / COLOR_PERIOD))
      palette.set(color, i * 4)
    }
    let link = 0
    for (let i = 0; i < POINTS; i++) {
      // The Storybook starts every point within [0.495, 0.505] of its 4096-unit space.
      // The site renderer restores these normalized coordinates to the same world positions.
      positions[i * 2] = (random() - 0.5) * 40.96 / 1000
      positions[i * 2 + 1] = (random() - 0.5) * 40.96 / 1000
      const cluster = i % COLOR_PERIOD
      pointClusters.push(cluster)
      colors.set(palette.subarray(cluster * 4, cluster * 4 + 4), i * 4)

      const addLink = (target: number): void => {
        links[link * 2] = i
        links[link * 2 + 1] = target
        linkColors.set(palette.subarray(cluster * 4, cluster * 4 + 4), link * 4)
        linkColors[link * 4 + 3] = 0.9
        link++
      }
      if (i % COLUMNS < COLUMNS - 1) addLink(i + 1)
      if (i + COLUMNS < POINTS) addLink(i + COLUMNS)
    }

    return {
      positions,
      colors,
      sizes,
      links,
      linkColors,
      linkWidths,
      pointClusters,
      updateColors: (tick): void => {
        const offset = tick % COLOR_PERIOD
        for (let i = 0; i < POINTS; i++) {
          const source = ((i - offset + COLOR_PERIOD) % COLOR_PERIOD) * 4
          const target = i * 4
          colors[target] = palette[source]!
          colors[target + 1] = palette[source + 1]!
          colors[target + 2] = palette[source + 2]!
          colors[target + 3] = palette[source + 3]!
        }
      },
    }
  },
}
