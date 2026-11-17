import type { Pattern } from './patterns'
export const WIDTH = 512; export const HEIGHT = 320
export type Point = { x: number; y: number; absent?: boolean; color?: [number, number, number, number] }
export type Link = { pattern?: Pattern; source: number; target: number; width: number; color: [number, number, number, number] }
export type Scene = { points: Point[]; links: Link[] }
export type HardCoverage = 'native' | 'linear' | 'pixel'
export type Settings = { pattern?: Pattern; dashLength?: number; dashGap?: number;
  endpointColors?: boolean; pointDefaultColor?: Link['color']; hardCoverage?: HardCoverage;
  zoom: number; ratio: number; opacity: number; blend: boolean; scaleOnZoom: boolean;
  widthScale: number; maxWidth: number; defaultWidth: number; defaultColor: Link['color']; reverse: boolean; indexOffset: number; }
export type Variant = 'production' | 'visible'
export const DEFAULTS: Settings = {
  zoom: 1,
  ratio: 1,
  opacity: 1,
  blend: true,
  scaleOnZoom: true,
  widthScale: 1,
  maxWidth: 128,
  defaultWidth: 3,
  defaultColor: [0.62, 0.71, 0.84, 1],
  reverse: false,
  indexOffset: 0,
}
export const FIXTURES = ['ribbons', 'overlap', 'limits', 'boundaries'] as const
export type Fixture = typeof FIXTURES[number]
export function resolveLink (link: Link, settings: Settings): Link {
  return {
    ...link,
    width: Number.isNaN(link.width) ? settings.defaultWidth : link.width,
    color: link.color.map((v, i) => Number.isNaN(v) ? settings.defaultColor[i] : v) as Link['color'],
  }
}
export function fixture (name: Fixture): Scene {
  const points: Point[] = []; const links: Link[] = []
  const add = (a: [number, number], b: [number, number], width: number, color: Link['color'] = [0.55, 0.72, 0.9, 1]): void => {
    links.push({ source: points.length, target: points.length + 1, width, color }); points.push({ x: a[0], y: a[1] }, { x: b[0], y: b[1] })
  }
  if (name === 'ribbons') {
    add([40, 48], [220, 48], 1); add([40, 95], [220, 95], 3, [0.85, 0.6, 0.35, 0.7])
    add([40, 154], [220, 154], 8); add([40, 218], [220, 218], 12, [0.65, 0.55, 0.85, 0.5])
    add([280, 40], [280, 260], 6); add([324, 65], [460, 202], 8); add([320, 240], [465, 193], 3)
  } else if (name === 'overlap') {
    add([80, 160], [432, 160], 24, [0.2, 0.5, 0.85, 1]); add([256, 45], [256, 275], 12, [0.95, 0.55, 0.3, 0.6])
    add([112, 64], [400, 257], 6, [0.7, 0.6, 0.9, 0.7])
    add([96, 160], [416, 160], 6, [0.95, 0.6, 0.3, 1 / 65536])
  } else if (name === 'limits') {
    for (const [i, width] of [0, 0.125, 0.5, NaN, 200].entries()) add([40, 35 + i * 51], [220, 35 + i * 51], width)
    add([300, 45], [470, 45], 8, [1, 0.6, 0.3, 0]); add([300, 115], [470, 115], 8, [NaN, NaN, NaN, NaN])
    add([300, 195], [470, 195], 8); points[points.length - 1].absent = true
    add([380, 270], [380, 270], 5)
  } else {
    add([40.5, 40.5], [220.5, 40.5], 1); add([40.25, 94.75], [220.75, 94.75], 2.5)
    add([280.5, 40.5], [280.5, 260.5], 0.5); add([330.25, 60.75], [460.75, 219.25], 3.5)
    add([40.5, 154.5], [220.5, 154.5], 0.125, [1, 1, 1, 0.01])
    add([40.5, 220.5], [220.5, 220.5], 4, [0.65, 0.8, 0.95, 1 / 65536])
    // Retain the aligned butt-cap counterexamples from the first ribbon replay.
    add([324, 65], [460, 201], 8); add([320, 240], [464, 192], 3)
  }
  return { points, links }
}
export const PROFILES: Array<{ name: string; settings: Partial<Settings> }> = [
  { name: 'Native', settings: {} }, { name: 'Retina', settings: { ratio: 2 } },
  { name: 'Zoom out · translucent · reversed', settings: { zoom: 0.5, opacity: 0.35, reverse: true } },
  { name: 'Constant width · zoom 2', settings: { zoom: 2, scaleOnZoom: false } },
  { name: 'Opacity zero', settings: { opacity: 0 } },
]
