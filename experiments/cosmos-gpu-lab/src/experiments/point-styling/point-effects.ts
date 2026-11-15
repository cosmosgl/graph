import { diameter, resolvePoint, type Point, type Settings } from './data'

export const RING_SCALE = 1.3
export const EFFECTS_SOURCE_ALPHA = {
  alpha: 'max(shapeCoverage * (subpixelArea * resolvedFillAlpha), sampledImageAlpha) * effectiveBodyOpacity; f32',
  bodyOpacity: 'Greyed + supplied greyoutOpacity: replace global opacity; otherwise use global opacity',
  decorations: 'Outline, hover and focus alpha do not contribute to source-byte picking eligibility',
} as const
export function shapeInradius (shape: number): number {
  return [1, 0.8, 0.9 / Math.sqrt(3), 0.8 * 1.2 / Math.sqrt(2.44), 0.726542528, 0.8, 0.405, 0.3][shape] ?? 1
}
export const greyed = (p: Point, s: Settings): boolean => !!s.highlighting && !!p.greyed
export const bodyOpacity = (p: Point, s: Settings): number => greyed(p, s) ? s.greyoutOpacity ?? s.opacity : s.opacity
export function greyRgb (rgb: number[], s: Settings): number[] {
  return rgb.map((c, i) => c * 0.35 + (s.darkenGreyout !== false ? 0.2 : Math.max(s.backgroundColor?.[i] ?? 0, 0.8)) * 0.65)
}
export function fillColor (p: Point, s: Settings): number[] {
  const color = resolvePoint(p, s).color
  return !greyed(p, s) ? color : s.greyoutColor ?? [...greyRgb(color.slice(0, 3), s), color[3]]
}
export function pointOrder (points: Point[], s: Settings): number[] {
  const order = points.map((_, i) => i); if (s.reverse) order.reverse()
  return s.highlighting ? [...order.filter(i => greyed(points[i], s)), ...order.filter(i => !greyed(points[i], s))] : order
}
export function spriteDiameter (p: Point, s: Settings, imageDiameter = 0): number {
  const core = Math.max(diameter(p, s), 1, imageDiameter)
  return Math.min(p.outlined ? RING_SCALE * core + 2 : core, s.maxSize * s.ratio)
}
export function overlayIndices (s: Settings, count: number): Array<{ index: number; color: number[] }> {
  const valid = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < count
  const hover = [...new Set(s.hovered ?? [])].filter(valid).map(index => ({ index, color: s.hoverColor ?? [1, 0.65, 0.2, 1] }))
  return [...hover, ...(s.focused !== undefined && valid(s.focused) ? [{ index: s.focused, color: s.focusColor ?? [0.55, 0.72, 0.95, 1] }] : [])]
}
const mul = (rows: number[][], v: number[]): number[] => rows.map(row => row.reduce((n, c, i) => n + c * v[i], 0))
const toLinear = (c: number): number => c < 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const toSrgb = (value: number): number => {
  const c = Math.max(0, Math.min(1, value)); return c < 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}
function labToLinear (lab: number[]): number[] {
  const lms = mul([[1, 0.3963377774, 0.2158037573], [1, -0.1055613458, -0.0638541728], [1, -0.0894841775, -1.2914855480]], lab)
  return mul([[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.7076147010]], lms.map(c => c ** 3))
}
// Scalar OKLab control: double-precision rows, separate from the shader port.
// The small gamut epsilon and eight bisections are the production color policy.
export function shadeColor (rgb: number[], direction: number, contrast: number): number[] {
  const lms = mul([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005]], rgb.map(toLinear)).map(Math.cbrt)
  const lab = mul([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660]], lms)
  const d = direction === 0 ? lab[0] > 0.6 ? -1 : 1 : direction
  lab[0] = Math.max(0, Math.min(1, lab[0] + d * contrast))
  const inGamut = (v: number[]): boolean => v.every(c => c >= -0.0001 && c <= 1.0001)
  if (!inGamut(labToLinear(lab))) {
    let low = 0; let high = 1
    for (let i = 0; i < 8; i++) {
      const mid = (low + high) * 0.5
      if (inGamut(labToLinear([lab[0], lab[1] * mid, lab[2] * mid]))) low = mid; else high = mid
    }
    lab[1] *= low; lab[2] *= low
  }
  return labToLinear(lab).map(toSrgb)
}
export function ringColor (p: Point, s: Settings): number[] {
  const original = resolvePoint(p, s)
  const color = p.ringColor && p.ringColor.every(Number.isFinite)
    ? p.ringColor
    : (s.ringShade ?? 2) === 2
      ? s.ringColor ?? [1, 1, 1, 1]
      : [...shadeColor(original.color.slice(0, 3), s.ringShade ?? 0, s.ringContrast ?? 0), 1]
  return greyed(p, s) ? [...greyRgb(color.slice(0, 3), s), color[3]] : color
}
export function strokeColor (p: Point, s: Settings): number[] {
  const resolved = resolvePoint(p, s); const fill = fillColor(p, s)
  if (!greyed(p, s)) {
    if (p.strokeColor.every(Number.isFinite)) return p.strokeColor
    if ((s.strokeShade ?? 2) === 2) return resolved.strokeColor
  }
  return [...shadeColor(fill.slice(0, 3), (s.strokeShade ?? 2) === 2 ? 0 : s.strokeShade ?? 0, s.strokeContrast ?? 0), 1]
}
