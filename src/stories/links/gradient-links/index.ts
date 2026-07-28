import { Graph, LinkStyle } from '@cosmos.gl/graph'

export const gradientLinks = (): { div: HTMLDivElement; graph: Graph; destroy?: () => void } => {
  // Create container div
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  const spaceSize = 4096

  // `linkColorInterpolateFromEndpoints` is orthogonal to the stroke pattern, so each row shows
  // a gradient combined with a different style: solid, dashed, dotted.
  const styles = [LinkStyle.Solid, LinkStyle.Dashed, LinkStyle.Dotted]
  const linkCount = styles.length

  // Each link blends from its source point color (left) to its target point color (right).
  const sourceRgb: [number, number, number] = [1.0, 0.42, 0.38] // warm
  const targetRgb: [number, number, number] = [0.25, 0.55, 0.95] // cool

  const pointPositions = new Float32Array(linkCount * 2 * 2)
  const pointColors = new Float32Array(linkCount * 2 * 4)
  const links = new Float32Array(linkCount * 2)
  const linkStyles = new Float32Array(styles)

  const leftX = spaceSize * 0.15
  const rightX = spaceSize * 0.85

  for (let i = 0; i < linkCount; i++) {
    const y = spaceSize * 0.5 + (i - (linkCount - 1) / 2) * (spaceSize * 0.08)

    const sourceIndex = i * 2
    const targetIndex = i * 2 + 1
    pointPositions[sourceIndex * 2] = leftX
    pointPositions[sourceIndex * 2 + 1] = y
    pointPositions[targetIndex * 2] = rightX
    pointPositions[targetIndex * 2 + 1] = y

    // Endpoint colors drive the gradient.
    pointColors[sourceIndex * 4] = sourceRgb[0]
    pointColors[sourceIndex * 4 + 1] = sourceRgb[1]
    pointColors[sourceIndex * 4 + 2] = sourceRgb[2]
    pointColors[sourceIndex * 4 + 3] = 1.0
    pointColors[targetIndex * 4] = targetRgb[0]
    pointColors[targetIndex * 4 + 1] = targetRgb[1]
    pointColors[targetIndex * 4 + 2] = targetRgb[2]
    pointColors[targetIndex * 4 + 3] = 1.0

    links[i * 2] = sourceIndex
    links[i * 2 + 1] = targetIndex
  }

  const graph = new Graph(div, {
    spaceSize,
    backgroundColor: '#2d313a',
    enableSimulation: false,
    rescalePositions: false,
    scaleLinksOnZoom: false,
    pointDefaultSize: 10,
    linkDefaultWidth: 8,
    linkDashLength: 16,
    linkDashGap: 12,
    // Interpolate each link's color from its source point color to its target point color.
    linkColorInterpolateFromEndpoints: true,
  })

  graph.setPointPositions(pointPositions)
  graph.setPointColors(pointColors)
  graph.setLinks(links)
  graph.setLinkStyles(linkStyles)

  graph.render()
  graph.fitView(0)

  return { div, graph }
}
