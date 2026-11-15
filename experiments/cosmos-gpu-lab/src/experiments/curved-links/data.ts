import { DEFAULTS as BASE, type Settings as BaseSettings, type Scene, type Point, type Link } from '../straight-links/data'
export { WIDTH, HEIGHT, resolveLink } from '../straight-links/data'
export type { Scene, Point, Link, Variant } from '../straight-links/data'
export type Settings = BaseSettings & { segments: number; weight: number; controlDistance: number }
export const DEFAULTS: Settings = { ...BASE, segments: 19, weight: 0.8, controlDistance: 0.5 }
export const FIXTURES = ['bows', 'overlap', 'limits', 'fractional'] as const
export type Fixture = typeof FIXTURES[number]
export function validateCurve (settings: Settings): void {
  if (!Number.isInteger(settings.segments) || settings.segments < 1 || settings.segments > 128 ||
    !Number.isFinite(settings.weight) || settings.weight <= 0 || !Number.isFinite(settings.controlDistance)) {
    throw new Error('The lab requires 1–128 segments, positive finite weight and finite control distance')
  }
}
export function fixture (name: Fixture): Scene {
  const points: Point[] = []; const links: Link[] = []
  const add = (a: [number, number], b: [number, number], width: number,
    color: Link['color'] = [0.55, 0.72, 0.9, 1]): void => {
    links.push({ source: points.length, target: points.length + 1, width, color }); points.push({ x: a[0], y: a[1] }, { x: b[0], y: b[1] })
  }
  if (name === 'bows') {
    add([40, 120], [220, 120], 3); add([280, 120], [460, 120], 8, [0.85, 0.6, 0.35, 0.7])
    add([220, 250], [40, 250], 5, [0.65, 0.55, 0.85, 1]); add([300, 270], [455, 200], 2)
  } else if (name === 'overlap') {
    add([80, 200], [432, 200], 14, [0.2, 0.5, 0.85, 1]); add([432, 120], [80, 120], 12, [0.95, 0.55, 0.3, 0.6])
    add([256, 270], [256, 50], 8, [0.7, 0.6, 0.9, 0.7])
    add([80, 200], [432, 200], 6, [0.95, 0.6, 0.3, 1 / 65536])
  } else if (name === 'limits') {
    add([40, 65], [200, 65], 0); add([40, 145], [200, 145], 0.25); add([40, 250], [200, 250], NaN, [NaN, NaN, NaN, NaN])
    add([290, 80], [320, 80], 48); add([370, 150], [470, 150], 6, [1, 0.6, 0.3, 0])
    add([280, 240], [360, 240], 8); points[points.length - 1].absent = true; add([430, 260], [430, 260], 5)
  } else {
    add([40.5, 115.5], [220.5, 115.5], 2.5); add([280.25, 120.75], [460.75, 150.25], 4.5)
    add([220.5, 270.5], [40.5, 270.5], 0.5, [0.65, 0.55, 0.85, 0.35])
    add([320.25, 280.75], [455.5, 225.5], 6)
  }
  return { points, links }
}
export const PROFILES: Array<{ name: string; settings: Partial<Settings> }> = [
  { name: 'Production defaults', settings: {} },
  { name: 'Coarse · 3 segments', settings: { segments: 3 } },
  { name: 'Fine · high bow', settings: { segments: 32, weight: 1.5, controlDistance: 0.75 } },
  { name: 'Inverse bow', settings: { controlDistance: -0.5 } },
  { name: 'Chord control', settings: { weight: 1, controlDistance: 0 } },
  { name: 'Retina', settings: { ratio: 2 } },
  { name: 'Zoom out · constant width · reversed', settings: { zoom: 0.5, scaleOnZoom: false, opacity: 0.35, reverse: true } },
  { name: 'Opacity zero', settings: { opacity: 0 } },
]
