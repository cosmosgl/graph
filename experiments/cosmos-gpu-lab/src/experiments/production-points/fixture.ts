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
export const pointPlacements = ['standard', 'offgrid', 'ties'] as const
export type PointPlacement = typeof pointPlacements[number]
export const tieControlDiameter = 22
const tieXByRow = [0, 0.5, 0.25, 0.125]
const tieYByColumn = [0, 0.5, 0.125]
const spaceSize = 512

export function parsePlacement (value: string | null): PointPlacement {
  return pointPlacements.find(placement => placement === value) ?? 'standard'
}

export function parseDiameter (value: string | null, placement: PointPlacement = 'standard'): number {
  if (placement === 'ties' && Number(value) === tieControlDiameter) return tieControlDiameter
  return fractionalDiameters.find(diameter => diameter === Number(value)) ?? defaultDiameter
}

type Sample = { row: number; column: number; shape: typeof pointShapes[number]; diameter: number; x: number; y: number }

export function pointSamples (diameter: number, placement: PointPlacement = 'standard', ratio: 1 | 2 = 1): Sample[] {
  return pointCases.flatMap((_, row) => pointShapes.map((shape, column) => {
    let x = column * pointCell.width + 16
    let y = row * pointCell.height + 19
    let size = row % 2 === 0 ? 22 : diameter
    if (placement === 'ties') {
      // Odd multiples of 1/32 device pixel exercise both neighbors of the 1/16 grid.
      // Keep the original 32 tie positions at 1× and the same subpixel phases at 2×.
      x += (1 / 32 + (column % 4) / 16 + tieXByRow[row]!) / ratio
      y += (1 / 32 + row / 16 + tieYByColumn[column % tieYByColumn.length]!) / ratio
      size = diameter === tieControlDiameter && row % 2 === 0 ? 24 : diameter
    } else if (row >= 2) {
      x += placement === 'offgrid' ? 0.1 : 0.25
      y += placement === 'offgrid' ? 0.4 : 0.375
    }
    return { row, column, shape, diameter: size, x, y }
  }))
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

export function loadPoints (graph: Graph, diameter: number, placement: PointPlacement = 'standard', ratio: 1 | 2 = 1): Sample[] {
  const { width, height } = pointsViewport
  const origin = spaceSize / 2
  // The identity camera centers the world origin in the viewport, with world y increasing upward.
  const samples = pointSamples(diameter, placement, ratio)
  const xy = samples.flatMap(({ x, y }) => [origin + x - width / 2, origin - y + height / 2])
  graph.setPointPositions(Float32Array.from(xy), true)
  graph.setPointShapes(Float32Array.from(samples, sample => sample.column))
  graph.setPointSizes(Float32Array.from(samples, sample => sample.diameter))
  graph.render(1, 0)
  graph.pause()
  graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
  return samples
}
