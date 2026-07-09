import { Graph, LinkStyle } from '@cosmos.gl/graph'

export const strokeStyles = (): { div: HTMLDivElement; graph: Graph; destroy?: () => void } => {
  // Create container div
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  const spaceSize = 4096

  // One link per stroke style, drawn as a horizontal line, stacked vertically.
  const styles = [LinkStyle.Solid, LinkStyle.Dashed, LinkStyle.Dotted]
  const linkCount = styles.length

  // Distinct color per link so the three styles are easy to tell apart.
  const linkRgb: [number, number, number][] = [
    [1.0, 0.42, 0.38], // Coral — Solid
    [0.25, 0.55, 0.95], // Blue — Dashed
    [0.20, 0.75, 0.55], // Green — Dotted
  ]

  const pointPositions = new Float32Array(linkCount * 2 * 2)
  const pointColors = new Float32Array(linkCount * 2 * 4)
  const links = new Float32Array(linkCount * 2)
  const linkColors = new Float32Array(linkCount * 4)
  const linkStyles = new Float32Array(styles)

  const leftX = spaceSize * 0.15
  const rightX = spaceSize * 0.85

  for (let i = 0; i < linkCount; i++) {
    const y = spaceSize * 0.5 + (i - (linkCount - 1) / 2) * (spaceSize * 0.08)

    // Two points per link (source on the left, target on the right).
    const sourceIndex = i * 2
    const targetIndex = i * 2 + 1
    pointPositions[sourceIndex * 2] = leftX
    pointPositions[sourceIndex * 2 + 1] = y
    pointPositions[targetIndex * 2] = rightX
    pointPositions[targetIndex * 2 + 1] = y

    // Neutral point color so the link color stands out.
    for (const p of [sourceIndex, targetIndex]) {
      pointColors[p * 4] = 0.85
      pointColors[p * 4 + 1] = 0.85
      pointColors[p * 4 + 2] = 0.9
      pointColors[p * 4 + 3] = 1.0
    }

    links[i * 2] = sourceIndex
    links[i * 2 + 1] = targetIndex

    const rgb = linkRgb[i] ?? [1, 1, 1]
    linkColors[i * 4] = rgb[0]
    linkColors[i * 4 + 1] = rgb[1]
    linkColors[i * 4 + 2] = rgb[2]
    linkColors[i * 4 + 3] = 1.0
  }

  const graph = new Graph(div, {
    spaceSize,
    backgroundColor: '#2d313a',
    enableSimulation: false,
    rescalePositions: false,
    scaleLinksOnZoom: false,
    pointDefaultSize: 6,
    linkDefaultWidth: 8,
    // Dash length / gap are global and apply to dashed links; dotted dots are sized to the link width.
    linkDashLength: 16,
    linkDashGap: 12,
  })

  graph.setPointPositions(pointPositions)
  graph.setPointColors(pointColors)
  graph.setLinks(links)
  graph.setLinkColors(linkColors)
  graph.setLinkStyles(linkStyles)

  graph.render()
  graph.fitView(0)

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
