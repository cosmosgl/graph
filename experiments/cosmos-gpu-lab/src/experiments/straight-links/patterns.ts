import type { Link, Settings } from './data'
export const PATTERNS = ['solid', 'dashed', 'dotted'] as const
export type Pattern = typeof PATTERNS[number]
export function patternCode (link: Link, settings: Settings): number {
  return PATTERNS.indexOf(link.pattern ?? settings.pattern ?? 'solid')
}
export function hasPatterns (links: Link[], settings: Settings): boolean {
  return links.some(link => patternCode(link, settings) > 0)
}

// Separate composition keeps the established solid shaders and probes intact.
export function patternShader (source: string, curved: boolean): string {
  const replace = (before: string, after: string): void => {
    if (source.split(before).length !== 2) throw new Error('Link pattern shader composition changed')
    source = source.replace(before, after)
  }
  replace('struct Vertex {', `struct Vertex {
  @location(8) @interpolate(flat) pattern: vec4f,
  @location(9) @interpolate(flat) stroke: u32,`)
  replace('result.coord = corner;', `let patternScale = select(zoom,1.0,params.options.x > 0.5);
  result.pattern = vec4f(distance * patternScale,${curved ? 'carrier' : 'quadWidth'} * patternScale,link.style.zw);
  result.stroke = u32(link.style.y);
  result.coord = corner;`)
  const start = source.indexOf('@fragment fn fragmentMain')
  if (start < 0) throw new Error('Missing link fragment entry')
  // Only acceptance fragmentMain, never the independent solid diagnostic probes.
  const head = source.slice(0, start); let body = source.slice(start)
  body = body.replace('let coverage = smoothstep', 'var coverage = smoothstep')
    .replace('  let alpha = input.color.a * coverage;', `  let motif = patternMask(input);
  if (params.options.z < 0.5 || params.options.w > 0.5) { coverage *= motif; }
  let alpha = input.color.a * coverage;`)
    .replace('  if (params.options.z > 0.0) {', `  if (params.options.z > 0.0) {
    if (params.options.w > 0.5 && input.stroke > 0u && coverage < 0.5) { discard; }`)
  return `${head + body}
// Evaluate every derivative before any style branch or discard.
fn patternMask(input: Vertex) -> f32 {
  let phase = clamp(input.coord.x,0.0,1.0) * input.pattern.x;
  let phaseDx = dpdx(phase); let phaseDy = dpdy(phase);
  let phaseAA = max(abs(phaseDx) + abs(phaseDy),1e-4) * 0.5;
  let dashPeriod = max(input.pattern.z + input.pattern.w,0.001);
  let dashLocal = phase - dashPeriod * floor(phase / dashPeriod);
  let dash = smoothstep(-phaseAA,phaseAA,dashLocal) *
    (1.0 - smoothstep(input.pattern.z - phaseAA,input.pattern.z + phaseAA,dashLocal));
  let baseDiameter = input.pattern.y * (1.0 - input.smoothing);
  let diameter = select(max(baseDiameter,1.4142136 * max(length(vec2f(phaseDx,phaseDy)),1e-4)),
    baseDiameter,params.options.y > 0.5);
  let dotPeriod = max(diameter + input.pattern.w,0.001);
  let localX = phase - dotPeriod * floor(phase / dotPeriod) - dotPeriod * 0.5;
  let radius = length(vec2f(localX,input.coord.y * input.pattern.y));
  let dotAA = max(fwidth(radius),1e-4) * 0.5;
  let dot = 1.0 - smoothstep(diameter * 0.5 - dotAA,diameter * 0.5 + dotAA,radius);
  return select(select(1.0,dash,input.stroke == 1u),dot,input.stroke == 2u);
}
`
}

export type PatternGeometry = { code: number; span: number; width: number; smoothing: number;
  coords(x: number, y: number): [number, number]; }
const clamp = (x: number): number => Math.max(0, Math.min(1, x))
function smooth (lo: number, hi: number, x: number): number { const t = clamp((x - lo) / (hi - lo)); return t * t * (3 - 2 * t) }
const mod = (x: number, period: number): number => x - period * Math.floor(x / period)
// Independent CPU model: four pixel-centre lanes, extrapolated from this
// primitive, and fine local differences. Native fwidth may choose coarse
// derivatives; any resulting mismatch remains a failure, not a waived pixel.
export function patternCoverage (g: PatternGeometry | undefined, settings: Settings, x: number, y: number): number {
  if (!g || !g.code) return 1
  const left = Math.floor(x / 2) * 2 + 0.5; const top = Math.floor(y / 2) * 2 + 0.5
  const coords = [[left, top], [left + 1, top], [left, top + 1], [left + 1, top + 1]].map(([x, y]) => g.coords(x, y))
  const phase = coords.map(c => clamp(c[0]) * g.span)
  const dx = [phase[1] - phase[0], phase[1] - phase[0], phase[3] - phase[2], phase[3] - phase[2]]
  const dy = [phase[2] - phase[0], phase[3] - phase[1], phase[2] - phase[0], phase[3] - phase[1]]
  const lane = (Math.floor(y) % 2) * 2 + Math.floor(x) % 2
  const length = Math.fround(settings.dashLength ?? 5); const gap = Math.fround(settings.dashGap ?? 5)
  if (g.code === 1) {
    const aa = Math.max(Math.abs(dx[lane]) + Math.abs(dy[lane]), 1e-4) * 0.5
    const local = mod(phase[lane], Math.max(length + gap, 0.001))
    return smooth(-aa, aa, local) * (1 - smooth(length - aa, length + aa, local))
  }
  const diameters = phase.map((_, i) => settings.blend
    ? g.width * (1 - g.smoothing)
    : Math.max(g.width * (1 - g.smoothing), 1.4142136 * Math.max(Math.hypot(dx[i], dy[i]), 1e-4)))
  const radii = phase.map((p, i) => {
    const period = Math.max(diameters[i] + gap, 0.001)
    return Math.hypot(mod(p, period) - period * 0.5, coords[i][1] * g.width)
  })
  const aa = Math.max(Math.abs(radii[(lane & 2) + 1] - radii[lane & 2]) +
    Math.abs(radii[(lane & 1) + 2] - radii[lane & 1]), 1e-4) * 0.5
  return 1 - smooth(diameters[lane] * 0.5 - aa, diameters[lane] * 0.5 + aa, radii[lane])
}
