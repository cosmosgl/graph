export const WIDTH = 512
export const HEIGHT = 320
export const SHAPES = ['Circle', 'Square', 'Triangle', 'Diamond', 'Pentagon', 'Hexagon', 'Star', 'Cross', 'None'] as const
export type Point = {
  x: number; y: number; size: number; shape: number; color: [number, number, number, number];
  stroke: number; strokeColor: [number, number, number, number]; absent?: boolean;
}
export type Settings = {
  zoom: number; ratio: number; scaleOnZoom: boolean; sizeScale: number; opacity: number; maxSize: number;
  defaultSize: number; defaultColor: [number, number, number, number];
  defaultStroke: number; defaultStrokeColor: [number, number, number, number]; reverse: boolean;
}
export const DEFAULTS: Settings = {
  zoom: 1,
  ratio: 1,
  scaleOnZoom: true,
  sizeScale: 1,
  opacity: 1,
  maxSize: 128,
  defaultSize: 36,
  defaultColor: [0.62, 0.71, 0.84, 1],
  defaultStroke: 3,
  defaultStrokeColor: [0.9, 0.92, 0.96, 1],
  reverse: false,
}
export function resolvePoint (point: Point, settings: Settings): Point {
  return {
    ...point,
    size: Number.isNaN(point.size) ? settings.defaultSize : point.size,
    color: point.color.map((v, i) => Number.isNaN(v) ? settings.defaultColor[i] : v) as Point['color'],
    stroke: Number.isNaN(point.stroke) ? settings.defaultStroke : point.stroke,
    strokeColor: point.strokeColor.some(Number.isNaN) ? settings.defaultStrokeColor : point.strokeColor,
  }
}
export function diameter (point: Point, settings: Settings): number {
  const zoom = settings.scaleOnZoom ? settings.zoom : Math.min(5, Math.max(1, settings.zoom * 0.01))
  return Math.min(resolvePoint(point, settings).size * settings.sizeScale * settings.ratio * zoom, settings.maxSize * settings.ratio)
}
export function center (point: Point, settings: Settings): [number, number] {
  return [(WIDTH / 2 + (point.x - WIDTH / 2) * settings.zoom) * settings.ratio,
    (HEIGHT / 2 + (point.y - HEIGHT / 2) * settings.zoom) * settings.ratio]
}
export function point (x: number, y: number, shape = 0, changes: Partial<Point> = {}): Point {
  return { x, y, shape, size: 42, color: [0.62, 0.71, 0.84, 1], stroke: 0, strokeColor: [0.95, 0.8, 0.57, 1], ...changes }
}
export type FixtureName = 'shapes' | 'overlap' | 'edge-cases' | 'fractional' | 'tiny-alpha' | 'tiny-overlap' | 'alpha-stack'
export function fixture (name: FixtureName): Point[] {
  if (name === 'alpha-stack') {
    return Array.from({ length: 64 }, () => point(256.5, 160.5, 0, { color: [1, 1, 1, 0.51 / 255] }))
  }
  if (name === 'tiny-alpha') {
    return [1, 1 / 255, 1 / 65536].flatMap((alpha, row) => [1 / 64, 1 / 8, 0.5, 2, 42].map((size, col) =>
      point(50 + col * 100 + (row === 1 ? 0.25 : 0.5), 60 + row * 100 + (row === 1 ? 0.75 : 0.5), 0,
        { size, color: [0.62, 0.71, 0.84, alpha] })))
  }
  if (name === 'tiny-overlap') {
    return [point(256, 160, 0, { size: 90, color: [0.3, 0.6, 0.9, 1] }),
      point(256, 160, 0, { size: 42, color: [0.95, 0.65, 0.35, 1 / 65536] })]
  }
  if (name === 'fractional') {
    return [0.25, 0.5, 1, 1.25, 2, 2.5, 3, 3.5, 7.5, 13.3, 22.5, 42.5].map((size, i) =>
      point(65.25 + (i % 4) * 125, 60.75 + Math.floor(i / 4) * 100, 0, { size }))
  }
  if (name === 'shapes') {
    return Array.from({ length: 16 }, (_, i) => point(46 + (i % 8) * 60, 100 + Math.floor(i / 8) * 120, i % 8, {
      size: 44,
      stroke: i < 8 ? 0 : 4,
      color: [0.44 + (i % 3) * 0.15, 0.66, 0.84, i % 8 === 7 ? 0.4 : 1],
    }))
  }
  if (name === 'overlap') {
    return [point(228, 160, 1, { size: 100, color: [0.8, 0.45, 0.4, 1] }),
      point(270, 160, 0, { size: 100, color: [0.45, 0.7, 0.88, 0.65], stroke: 5 }),
      point(256, 180, 6, { size: 70, color: [0.92, 0.76, 0.42, 1] })]
  }
  return [
    point(50, 130, 0, { size: NaN, color: [NaN, 0.65, NaN, 1], stroke: NaN, strokeColor: [NaN, NaN, NaN, NaN] }),
    point(125, 130, 0, { size: 0 }), point(200, 130, 0, { color: [1, 0.5, 0.5, 0] }),
    point(275, 130, 8), point(350, 130, 2, { absent: true }), point(450, 130, 0, { size: 240, stroke: 20 }),
    point(100.5, 240.5, 0, { size: 0.5 }), point(180, 240, 7, { size: 24, stroke: 100 }),
    point(290, 240, 3, { size: 36, stroke: 3, color: [0.5, 0.75, 0.9, 0.25] }),
  ]
}
