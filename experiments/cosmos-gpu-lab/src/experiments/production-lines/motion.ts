import type { Graph } from '../../../../../dist/index.js'
import { background, lineViewport, type Probe } from './fixture'

export const motionCase = 'endpoint-motion'
export const phaseSteps = 32
export type MotionStyle = 'dashed' | 'solid'

// In the 30-link cap sweep these are links 28 and 19, in opposite directions.
// Coordinates are projected CSS pixels at the fixed camera; only the source moves.
const strokes = [
  { x: 226.25, source: 82.5, target: 137.43 },
  { x: 73.25, source: 136.5, target: 83.47 },
] as const
const dash = 8
const gap = 6
const width = 2.3

function sourceY (id: number, phase: number, ratio: number): number {
  return strokes[id]!.source + phase / (phaseSteps * ratio)
}

export function loadMotion (graph: Graph, style: MotionStyle): void {
  graph.setPointPositions(Float32Array.from(strokes.flatMap(({ x, source, target }) =>
    [128 + x, 336 - source, 128 + x, 336 - target])), true)
  graph.setPointSizes(new Float32Array(4))
  graph.setLinks(Float32Array.of(0, 1, 2, 3))
  graph.setLinkWidths(Float32Array.of(width, width))
  graph.setLinkColors(Float32Array.of(0.3, 0.7, 0.9, 1, 0.3, 0.7, 0.9, 1))
  graph.setLinkStyles(Float32Array.of(style === 'dashed' ? 1 : 0, style === 'dashed' ? 1 : 0))
  graph.setLinkArrows([false, false])
  graph.render(1, 0)
  graph.pause()
  graph.setViewTransform({ k: 1, x: 0, y: 0 }, [lineViewport.width, lineViewport.height])
}

export function setPhase (graph: Graph, phase: number, ratio: number): void {
  for (const [id, { x }] of strokes.entries()) graph.setPointPosition(2 * id, 128 + x, 336 - sourceY(id, phase, ratio))
}

export function motionProbes (phase: number, ratio: number, style: MotionStyle): Probe[] {
  const probes: Probe[] = []
  for (const [id, { x, target }] of strokes.entries()) {
    const y = sourceY(id, phase, ratio)
    const direction = Math.sign(target - y)
    for (const [label, distance] of [['Stroke', dash / 2], [style === 'dashed' ? 'Paint gap' : 'Solid control', dash + gap / 2]] as const) {
      probes.push({ label, xy: [Math.floor(x), Math.floor(y + direction * distance)], expected: `Link ${id}` })
    }
  }
  probes.push({ label: 'Clear background', xy: [150, 110], expected: 'Background' })
  return probes
}

/** Check the middle of each complete dash and gap against the intended style.
 * The partly clipped last period can legitimately enter or leave the stroke. */
export function inspectMotionPaint (image: ImageData, phase: number, ratio: number, style: MotionStyle): { missing: number; paintedGaps: number } {
  let missing = 0
  let paintedGaps = 0
  for (const [id, { x, target }] of strokes.entries()) {
    const source = sourceY(id, phase, ratio)
    const length = Math.abs(target - source)
    const sample = (distance: number): number => {
      const y = Math.floor((source + Math.sign(target - source) * distance) * ratio)
      return image.data[(y * image.width + Math.floor(x * ratio)) * 4 + 2]!
    }
    for (let start = 0; start + dash <= length; start += dash + gap) {
      // Blue is the channel with the most contrast. Require half the intended
      // foreground coverage at the center of this 2.3 CSS-pixel-wide stroke.
      if (sample(start + dash / 2) < (background[2] + 0.9 * 255) / 2) missing++
      if (style === 'dashed' && start + dash + gap <= length && sample(start + dash + gap / 2) !== background[2]) paintedGaps++
    }
  }
  return { missing, paintedGaps }
}

/** Include the entire swept area, including the fringe and one device pixel
 * beyond it. Full-frame comparisons independently catch displaced geometry. */
export function motionPixelIndices (ratio: number): number[] {
  const indices: number[] = []
  for (const { x, source, target } of strokes) {
    const top = Math.floor(Math.min(source, target) * ratio) - 3
    const bottom = Math.ceil(Math.max(source, target) * ratio) + 3
    for (let y = top; y <= bottom; y++) {
      for (let col = Math.floor((x - width / 2) * ratio) - 2; col <= Math.ceil((x + width / 2) * ratio) + 2; col++) {
        indices.push(y * lineViewport.width * ratio + col)
      }
    }
  }
  return indices
}

/** An out-and-back change during monotone motion while the reference pixel holds
 * steady is a flash. A single shifted edge transition is allowed by the edge rule. */
export function findMotionFlashes (
  gl: Uint8Array[], gpu: Uint8Array[], indices: number[], ratio: number
): { pixels: number; largest: number; worst?: { x: number; y: number; firstPhase: number; lastPhase: number } } {
  let pixels = 0
  let largest = 0
  let worst: { x: number; y: number; firstPhase: number; lastPhase: number } | undefined
  for (const [i, index] of indices.entries()) {
    let found = false
    for (let start = 0; start < gl.length - 2; start++) {
      let refMin = gl[start]![i]!
      let refMax = refMin
      const first = gpu[start]![i]!
      let lo = first
      let hi = first
      for (let end = start + 1; end < gl.length; end++) {
        const reference = gl[end]![i]!
        refMin = Math.min(refMin, reference)
        refMax = Math.max(refMax, reference)
        if (refMax - refMin > 2) break
        const last = gpu[end]![i]!
        lo = Math.min(lo, last)
        hi = Math.max(hi, last)
        const reversal = Math.max(hi - Math.max(first, last), Math.min(first, last) - lo)
        if (reversal <= 2) continue
        found = true
        if (reversal > largest) {
          largest = reversal
          const widthPx = lineViewport.width * ratio
          worst = { x: index % widthPx, y: Math.floor(index / widthPx), firstPhase: start - phaseSteps, lastPhase: end - phaseSteps }
        }
      }
    }
    if (found) pixels++
  }
  return { pixels, largest, worst }
}
