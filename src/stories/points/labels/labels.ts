import { LabelRenderer, LabelOptions } from '@interacta/css-labels'
import { Graph } from '@cosmos.gl/graph'

export class CosmosLabels {
  private labelRenderer: LabelRenderer
  private labels: LabelOptions[] = []
  private pointIndexToLabel: Map<number, string>

  public constructor (div: HTMLDivElement, pointIndexToLabel: Map<number, string>) {
    this.labelRenderer = new LabelRenderer(div, { pointerEvents: 'none' })
    this.pointIndexToLabel = pointIndexToLabel
  }

  public update (graph: Graph): void {
    // Get coordinates of the tracked nodes
    const trackedNodesPositions = graph.getTrackedPointPositionsMap()
    let index = 0
    trackedNodesPositions.forEach((positions, pointIndex) => {
      // Convert coordinates to the screen space
      const screenPosition = graph.spaceToScreenPosition([
        positions?.[0] ?? 0,
        positions?.[1] ?? 0,
      ])

      // Get the node radius and convert it to the screen space value in pixels
      const radius = graph.spaceToScreenRadius(
        graph.getPointRadiusByIndex(pointIndex) as number
      )

      // Set label properties
      this.labels[index] = {
        id: `${pointIndex}`,
        text: this.pointIndexToLabel.get(pointIndex) ?? '',
        x: screenPosition[0],
        y: screenPosition[1] - (radius + 2),
        opacity: 1,
      }

      index += 1
    })

    // Pass labels configuration to the renderer and draw them
    this.labelRenderer.setLabels(this.labels)
    this.labelRenderer.draw(true)
  }
}
