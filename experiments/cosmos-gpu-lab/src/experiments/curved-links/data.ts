import { DEFAULTS as BASE, type Settings as BaseSettings, type Scene, type Point, type Link } from '../straight-links/data'
export { WIDTH, HEIGHT, resolveLink } from '../straight-links/data'
export type { Scene, Point, Link } from '../straight-links/data'
export type Variant = 'production' | 'visible' | 'front'
export type Settings = BaseSettings & { segments: number; weight: number; controlDistance: number }
export const DEFAULTS: Settings = { ...BASE, segments: 19, weight: 0.8, controlDistance: 0.5 }
export type Fixture = 'bows' | 'folded' | 'overlap'
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
  } else {
    add([290, 80], [320, 80], 48)
  }
  return { points, links }
}
