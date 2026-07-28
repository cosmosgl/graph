import { LabelRenderer, LabelOptions } from '@interacta/css-labels'
import { Graph } from '@cosmos.gl/graph'

const FONT_SIZE = 12
const LINE_HEIGHT = 1.4
const LABEL_PADDING = {
  top: 6,
  right: 9,
  bottom: 6,
  left: 9,
}

/** Normalize to (-90, 90] so text is never upside down. Returns rotation and whether it was flipped. */
function normalizeRotation (deg: number): { rotation: number; flipped: boolean } {
  let d = deg
  while (d > 90) d -= 180
  while (d <= -90) d += 180
  const flipped = deg > 90 || deg <= -90
  return { rotation: d, flipped }
}

export class LinkSamplingLabels {
  private labelRenderer: LabelRenderer

  public constructor (container: HTMLDivElement) {
    this.labelRenderer = new LabelRenderer(container, { pointerEvents: 'none' })
  }

  public update (graph: Graph): void {
    const { indices, positions, angles } = graph.getSampledLinks()
    const linkColors = graph.getLinkColors()
    const links = graph.graph.links

    const labelOptions: LabelOptions[] = indices.map((linkIdx, i) => {
      // Text
      const source = Math.round(links?.[linkIdx * 2] ?? 0)
      const target = Math.round(links?.[linkIdx * 2 + 1] ?? 0)
      const text = links != null ? `${source} → ${target}` : String(linkIdx)

      // Color
      const base = linkIdx * 4
      const hasColor = linkColors.length >= base + 4
      const r = Math.round((linkColors[base] ?? 0) * 255)
      const g = Math.round((linkColors[base + 1] ?? 0) * 255)
      const b = Math.round((linkColors[base + 2] ?? 0) * 255)
      const color = hasColor ? `rgba(${r}, ${g}, ${b}, 0.9)` : 'rgba(120, 120, 140, 0.9)'

      // Position and rotation
      const [screenX, screenY] = graph.spaceToScreenPosition([
        positions[i * 2] ?? 0,
        positions[i * 2 + 1] ?? 0,
      ])
      const angleRad = angles[i] ?? 0
      const { rotation, flipped } = normalizeRotation((angleRad * 180) / Math.PI)

      // Outer normal of the curve (perpendicular to chord, toward control point)
      const outerX = Math.sin(angleRad)
      const outerY = -Math.cos(angleRad)

      // When flipped, the label extends inward from its anchor; push the anchor out by
      // the full label height so the inner edge stays at the curve.
      const labelHeight = LINE_HEIGHT * FONT_SIZE + LABEL_PADDING.top + LABEL_PADDING.bottom
      const dist = flipped ? labelHeight : 0
      const x = screenX + dist * outerX
      const y = screenY + dist * outerY

      return {
        id: `link-${linkIdx}`,
        text,
        x,
        y,
        rotation,
        fontSize: FONT_SIZE,
        padding: LABEL_PADDING,
        opacity: 0.9,
        style: `background: none; color: ${color}; font-weight: 500`,
      }
    })

    this.labelRenderer.setLabels(labelOptions)
    this.labelRenderer.draw()
  }
}
