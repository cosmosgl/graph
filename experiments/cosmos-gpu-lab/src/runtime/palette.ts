// Presentation only: never use palette values in force calculations or color-test fixtures.
export const graphPalette = {
  background: '#252930',
  point: '#aac7e8',
  pinned: '#f4d889',
  link: '#7f8998',
  coral: '#ed695b',
  // Match the collision shaders' 40% RGB intensity inside disc outlines.
  pointInterior: '#44505d',
  pinnedInterior: '#625637',
} as const

type Color = keyof typeof graphPalette
type Rgba = [number, number, number, number]

export const graphRgba = Object.fromEntries(Object.entries(graphPalette).map(([name, hex]) => [
  name, [...hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255), 1],
])) as Record<Color, Rgba>

// Decimal literals work in both GLSL and WGSL, including channels equal to zero or one.
export const graphRgb = Object.fromEntries(Object.entries(graphRgba).map(([name, rgba]) => [
  name, rgba.slice(0, 3).map(channel => channel.toFixed(8)).join(','),
])) as Record<Color, string>

export const graphWgsl = `const graphPointColor = vec4f(${graphRgb.point}, 1.0);
const graphHighlightColor = vec4f(${graphRgb.pinned}, 1.0);\n`

export const comparisonSeries = {
  webgl: { color: graphPalette.pinned, dash: '6 4' },
  webgpu: { color: graphPalette.point, dash: '' },
  cpu: { color: graphPalette.coral, dash: '2 4' },
} as const

export function seriesKey (series: { color: string; dash: string }, label: string): string {
  return `<span class="chart-series-key"><svg width="24" height="12" aria-hidden="true">
    <line x1="0" y1="6" x2="24" y2="6" stroke="${series.color}" stroke-width="2" stroke-dasharray="${series.dash}"/>
    </svg>${label}</span>`
}
