import { Graph } from '@cosmos.gl/graph'
import { generateHierarchyData } from './data-gen'
import './style.css'

/**
 * Explore Connections — interactive demo of highlighting, outlining, and focusing.
 *
 * Hover (soft preview):
 * • Point → outlines it and its neighbors, softly fades non-connected links
 * • Link  → outlines its endpoints, softly fades other links
 *
 * Click (full exploration):
 * • Point → focuses it (ring), highlights neighborhood + connected links, greys out the rest
 * • Link  → focuses it (thickens), highlights it and its endpoints, greys out the rest
 * • Click again or click background → clears all
 */
export const exploreConnections = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.className = 'app'

  const graphDiv = document.createElement('div')
  graphDiv.className = 'graph'
  div.appendChild(graphDiv)

  const infoPanel = document.createElement('div')
  infoPanel.className = 'info-panel'
  infoPanel.innerHTML = '<span class="hint">Hover over points or links to preview, click to explore</span>'
  div.appendChild(infoPanel)

  const { pointPositions, pointColors, pointSizes, links, linkColors } = generateHierarchyData()

  // Track what the user has clicked so hover doesn't interfere
  let clicked: { type: 'point'; index: number } | { type: 'link'; index: number } | undefined

  function clearAll (): void {
    clicked = undefined
    graph.setConfigPartial({
      focusedPointIndex: undefined,
      focusedLinkIndex: undefined,
      highlightedPointIndices: undefined,
      highlightedLinkIndices: undefined,
      outlinedPointIndices: undefined,
    })
    infoPanel.innerHTML = '<span class="hint">Hover over points or links to preview, click to explore</span>'
  }

  // Hover: lightweight preview with outlines and soft link fading
  function onPointHover (pointIndex: number): void {
    if (clicked) return
    const neighbors = graph.getNeighboringPointIndices(pointIndex)
    const neighborhood = [pointIndex, ...neighbors]
    const connectedLinks = graph.getConnectedLinkIndices(neighborhood)
    graph.setConfigPartial({
      outlinedPointIndices: neighborhood,
      highlightedLinkIndices: connectedLinks,
      linkGreyoutOpacity: 0.3,
    })
  }

  function onLinkHover (linkIndex: number): void {
    if (clicked) return
    const endpoints = graph.getConnectedPointIndices(linkIndex)
    graph.setConfigPartial({
      outlinedPointIndices: endpoints,
      highlightedLinkIndices: [linkIndex],
      linkGreyoutOpacity: 0.3,
    })
  }

  function clearHover (): void {
    if (clicked) return
    graph.setConfigPartial({
      outlinedPointIndices: undefined,
      highlightedLinkIndices: undefined,
    })
  }

  // Click: full highlight with greyout — the clicked element and its connections stand out
  function onPointClicked (pointIndex: number): void {
    if (clicked?.type === 'point' && clicked.index === pointIndex) {
      clearAll()
      return
    }

    clicked = { type: 'point', index: pointIndex }

    const neighbors = graph.getNeighboringPointIndices(pointIndex)
    const neighborhood = [pointIndex, ...neighbors]
    const connectedLinks = graph.getConnectedLinkIndices(neighborhood)

    graph.setConfigPartial({
      focusedPointIndex: pointIndex, // ring around the clicked point
      highlightedPointIndices: neighborhood, // neighborhood stays visible, rest greys out
      outlinedPointIndices: undefined,
      highlightedLinkIndices: connectedLinks, // connected links stay visible
      focusedLinkIndex: undefined,
      linkGreyoutOpacity: 0.05,
    })

    infoPanel.innerHTML =
      `<b>Point ${pointIndex}</b> — ${neighbors.length} neighbor${neighbors.length !== 1 ? 's' : ''}, ` +
      `${connectedLinks.length} link${connectedLinks.length !== 1 ? 's' : ''}` +
      '<br><span class="hint">Click again to clear, or click another point or link</span>'
  }

  function onLinkClicked (linkIndex: number): void {
    if (clicked?.type === 'link' && clicked.index === linkIndex) {
      clearAll()
      return
    }

    clicked = { type: 'link', index: linkIndex }

    const endpoints = graph.getConnectedPointIndices(linkIndex)

    graph.setConfigPartial({
      focusedPointIndex: undefined,
      focusedLinkIndex: linkIndex, // thicken the clicked link
      highlightedLinkIndices: [linkIndex], // only this link stays visible
      highlightedPointIndices: endpoints, // its endpoints stay visible
      outlinedPointIndices: undefined,
      linkGreyoutOpacity: 0.05,
    })

    infoPanel.innerHTML =
      `<b>Link ${linkIndex}</b> — connecting points ${endpoints.join(' and ')}` +
      '<br><span class="hint">Click again to clear, or click another point or link</span>'
  }

  const config = {
    spaceSize: 4096,
    backgroundColor: '#2d313a',
    enableSimulation: false,
    enableDrag: false,
    curvedLinks: true,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',

    // Point appearance
    pointDefaultSize: 10,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#ffffff',
    focusedPointRingColor: '#ffffff',
    outlinedPointRingColor: '#aabbff',
    pointGreyoutOpacity: 0.15,

    // Link appearance
    linkDefaultWidth: 1.5,
    linkDefaultColor: '#5F74C2',
    hoveredLinkWidthIncrease: 1,
    focusedLinkWidthIncrease: 2,
    linkGreyoutOpacity: 0.05,

    // Hover callbacks → outline preview
    onPointMouseOver: (index: number): void => { onPointHover(index) },
    onPointMouseOut: (): void => { clearHover() },
    onLinkMouseOver: (index: number): void => { onLinkHover(index) },
    onLinkMouseOut: (): void => { clearHover() },

    // Click callbacks → full highlight
    onPointClick: (index: number): void => { onPointClicked(index) },
    onLinkClick: (index: number): void => { onLinkClicked(index) },
    onBackgroundClick: (): void => { clearAll() },
  }

  const graph = new Graph(graphDiv, config)

  graph.setPointPositions(pointPositions)
  graph.setPointColors(pointColors)
  graph.setPointSizes(pointSizes)
  graph.setLinks(links)
  graph.setLinkColors(linkColors)
  graph.zoom(0.9)
  graph.render()

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
