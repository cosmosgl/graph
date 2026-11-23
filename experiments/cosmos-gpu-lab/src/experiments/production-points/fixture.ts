import type { Graph } from '../../../../../dist/index.js'

export const pointShapes = ['Circle', 'Square', 'Triangle', 'Diamond', 'Pentagon', 'Hexagon', 'Star', 'Cross'] as const
export const pointCases = ['Integer size and position', 'Fractional size', 'Fractional position', 'Fractional size and position'] as const
export const pointCell = { width: 33, height: 38 }
export const pointsViewport = { width: pointShapes.length * pointCell.width, height: pointCases.length * pointCell.height }
export const pointFill = [118, 192, 224] as const
export const pointBackground = [24, 32, 43] as const

// Each diameter remains fractional in device pixels at both tested pixel ratios.
export const fractionalDiameters = [22.3, 22.625, 22.75, 22.125] as const
export const defaultDiameter = fractionalDiameters[0]
const spaceSize = 512

export function parseDiameter (value: string | null): number {
  return fractionalDiameters.find(diameter => diameter === Number(value)) ?? defaultDiameter
}

type Sample = { row: number; column: number; shape: typeof pointShapes[number]; diameter: number; x: number; y: number }

export function pointSamples (diameter: number): Sample[] {
  return pointCases.flatMap((_, row) => pointShapes.map((shape, column) => ({
    row,
    column,
    shape,
    diameter: row % 2 === 0 ? 22 : diameter,
    x: column * pointCell.width + 16 + (row >= 2 ? 0.25 : 0),
    y: row * pointCell.height + 19 + (row >= 2 ? 0.375 : 0),
  })))
}

export const pointsConfig = {
  spaceSize,
  enableSimulation: false,
  enableRenderLoop: false,
  enableZoom: false,
  fitViewOnInit: false,
  rescalePositions: false,
  transitionDuration: 0,
  backgroundColor: `rgb(${pointBackground.join(',')})`,
  pointDefaultColor: `rgb(${pointFill.join(',')})`,
}

export function loadPoints (graph: Graph, diameter: number): void {
  const { width, height } = pointsViewport
  const origin = spaceSize / 2
  // The identity camera centers the world origin in the viewport, with world y increasing upward.
  const samples = pointSamples(diameter)
  const xy = samples.flatMap(({ x, y }) => [origin + x - width / 2, origin - y + height / 2])
  graph.setPointPositions(Float32Array.from(xy), true)
  graph.setPointShapes(Float32Array.from(samples, sample => sample.column))
  graph.setPointSizes(Float32Array.from(samples, sample => sample.diameter))
  graph.render(1, 0)
  graph.pause()
  graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
}
