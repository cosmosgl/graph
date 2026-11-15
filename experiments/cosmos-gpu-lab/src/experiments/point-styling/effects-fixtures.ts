import { DEFAULTS, point, type Point, type Settings } from './data'

export const EFFECTS_FIXTURES = ['shapes', 'overlap', 'images', 'limits'] as const
export type EffectsFixture = typeof EFFECTS_FIXTURES[number]
export function effectsPoints (name: EffectsFixture = 'shapes'): Point[] {
  if (name === 'overlap') {
    return [point(240.5, 160.5, 1, { size: 104, color: [0.2, 0.45, 0.8, 1], outlined: true }),
      point(268.5, 160.5, 0, { size: 86, color: [0.9, 0.5, 0.25, 0.8], greyed: true, outlined: true }),
      point(256.5, 190.5, 6, { size: 54, greyed: true, outlined: true, ringColor: [0.75, 0.7, 0.95, 0.6] })]
  }
  if (name === 'images') {
    return [point(160.5, 160.5, 1, { size: 100, color: [0.2, 0.45, 0.8, 1], outlined: true }),
      point(160.5, 160.5, 8, { size: 0, color: [0, 0, 0, 0], image: 0, imageSize: 64, greyed: true, outlined: true }),
      point(300.5, 160.5, 0, { size: 44, image: 0, imageSize: 72, greyed: true, outlined: true }),
      point(420.5, 160.5, 8, { size: 0, image: 3, imageSize: 38, greyed: true, outlined: true })]
  }
  if (name === 'limits') {
    return [0, 0.25, 0.5, 2, 128, 42].map((size, i) => point(40.5 + i * 84, 160.5, 0, {
      size, greyed: i % 2 === 1, outlined: true, color: [0.4, 0.7, 0.85, i === 5 ? 0 : 1], absent: i === 3,
    }))
  }
  return Array.from({ length: 16 }, (_, i) => point(46.5 + i % 8 * 60, 100.5 + Math.floor(i / 8) * 120, i % 8, {
    size: 40,
    outlined: true,
    greyed: i >= 8,
    stroke: i >= 8 ? 3 : 0,
    color: [0.35 + (i % 3) * 0.18, 0.65, 0.8, i % 8 === 7 ? 0.4 : 1],
    ringColor: i % 4 === 1 ? [0.95, 0.65, 0.25, 0.65] : undefined,
  }))
}
export const EFFECTS_PROFILES: Array<{ name: string; settings: Partial<Settings>; allGreyed?: boolean }> = [
  { name: 'Darken', settings: { highlighting: true, darkenGreyout: true, hovered: [0, 0, 1], focused: 0 } },
  { name: 'Lighten', settings: { highlighting: true, darkenGreyout: false, backgroundColor: [0.92, 0.93, 0.95, 1], hovered: [1] } },
  { name: 'Greyout override', settings: { highlighting: true, greyoutColor: [0.5, 0.6, 0.7, 0.6], greyoutOpacity: 0.35, focused: 1 } },
  { name: 'Hidden grey body', settings: { highlighting: true, greyoutOpacity: 0, hovered: [1] } },
  { name: 'Zero global / visible grey', settings: { highlighting: true, opacity: 0, greyoutOpacity: 0.35, hovered: [0, 1], focused: 1 } },
  { name: 'Auto ring / stroke', settings: { highlighting: true, ringShade: 0, ringContrast: 0.12, strokeShade: 0, strokeContrast: 0.1 } },
  { name: 'Highlighting cleared', settings: { highlighting: false, hovered: [1], focused: 0 } },
  { name: 'All greyed', settings: { highlighting: true, greyoutOpacity: 0.35, hovered: [0], focused: 1 }, allGreyed: true },
]
export const EFFECTS_VIEWS = [
  { name: 'Native', settings: {} },
  { name: 'Retina', settings: { ratio: 2 } },
  { name: 'Zoom out · translucent · reversed', settings: { zoom: 0.5, opacity: 0.35, reverse: true } },
] satisfies Array<{ name: string; settings: Partial<Settings> }>
export function effectScenario (name: EffectsFixture, profile: number, view: Partial<Settings> = {}): { points: Point[]; settings: Settings } {
  const preset = EFFECTS_PROFILES[profile]
  return {
    points: effectsPoints(name).map(p => ({ ...p, greyed: preset.allGreyed || p.greyed })),
    settings: { ...DEFAULTS, atlasIsolation: 'texel', ...view, ...preset.settings },
  }
}
