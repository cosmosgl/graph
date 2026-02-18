import { LabelRenderer, LabelOptions } from '@interacta/css-labels'
import { Graph } from '@cosmos.gl/graph'

const LABEL_OFFSET_Y = 9 // lib anchors bottom-center; offset so label is centered on link midpoint

/** Keep label right-side up: normalize rotation to (-90, 90] so text is never upside down. */
function normalizeLabelRotation (deg: number): number {
  let d = deg
  while (d > 90) d -= 180
  while (d <= -90) d += 180
  return d
}

function rgbaToCss (r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`
}

function labelStyle (borderColor: string): string {
  return [
    'background: rgba(24, 26, 32, 0.88)',
    `border: 1px solid ${borderColor}`,
    'padding: 4px 8px',
    'border-radius: 6px',
    'color: rgba(255, 255, 255, 0.9)',
    'font-weight: 500',
    'letter-spacing: 0.03em',
    'white-space: nowrap',
    'box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2)',
    'font-family: Nunito Sans, -apple-system, Segoe UI, Helvetica, Arial, sans-serif',
  ].join('; ')
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

    const labelOptions: LabelOptions[] = []

    for (const [i, linkIdx] of indices.entries()) {
      const x = positions[i * 2] ?? 0
      const y = positions[i * 2 + 1] ?? 0
      const angleRad = angles[i] ?? 0
      const rotationDeg = normalizeLabelRotation((angleRad * 180) / Math.PI)
      const [screenX, screenY] = graph.spaceToScreenPosition([x, y])

      const source = links != null ? Math.round(links[linkIdx * 2] ?? 0) : linkIdx
      const target = links != null ? Math.round(links[linkIdx * 2 + 1] ?? 0) : -1
      const text = target >= 0 ? `${source} → ${target}` : String(linkIdx)

      let borderColor = 'rgba(120, 120, 140, 0.8)'
      if (linkColors.length >= (linkIdx + 1) * 4) {
        const r = linkColors[linkIdx * 4] ?? 0
        const g = linkColors[linkIdx * 4 + 1] ?? 0
        const b = linkColors[linkIdx * 4 + 2] ?? 0
        borderColor = rgbaToCss(r, g, b, 1)
      }

      labelOptions.push({
        id: `link-${linkIdx}`,
        text,
        x: screenX,
        y: screenY + LABEL_OFFSET_Y,
        rotation: rotationDeg,
        fontSize: 10,
        opacity: 0.9,
        style: labelStyle(borderColor),
      })
    }

    this.labelRenderer.setLabels(labelOptions)
    this.labelRenderer.draw()
  }
}
