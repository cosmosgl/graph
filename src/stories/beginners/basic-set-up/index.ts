import { Graph } from '@cosmos.gl/graph'
import { generateData } from './data-gen'
import './style.css'

export const basicSetUp = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.className = 'app'

  const graphDiv = document.createElement('div')
  graphDiv.className = 'graph'
  div.appendChild(graphDiv)

  const actionsDiv = document.createElement('div')
  actionsDiv.className = 'actions'
  div.appendChild(actionsDiv)

  const actionsHeader = document.createElement('div')
  actionsHeader.className = 'actions-header'
  actionsHeader.textContent = 'Actions'
  actionsDiv.appendChild(actionsHeader)

  const graph = new Graph(graphDiv, {
    spaceSize: 4096,
    backgroundColor: '#2d313a',
    pointDefaultSize: 4,
    pointDefaultColor: '#4B5BBF',
    linkDefaultWidth: 0.6,
    scalePointsOnZoom: true,
    linkDefaultColor: '#5F74C2',
    linkDefaultArrows: false,
    linkGreyoutOpacity: 0,
    curvedLinks: true,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#4B5BBF',
    enableDrag: true,
    simulationLinkDistance: 1,
    simulationLinkSpring: 2,
    simulationRepulsion: 0.2,
    simulationGravity: 0.1,
    simulationDecay: 100000,
    onPointClick: (index: number): void => {
      graph.setConfig({ highlightedPointIndices: [index], outlinedPointIndices: [index], highlightedLinkIndices: [] })
      graph.zoomToPointByIndex(index)
      console.log('Clicked point index: ', index)
    },
    onBackgroundClick: (): void => {
      graph.setConfig({ highlightedPointIndices: undefined, highlightedLinkIndices: undefined })
      console.log('Clicked background')
    },
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  })

  const { pointPositions, links } = generateData()
  graph.setPointPositions(pointPositions)
  graph.setLinks(links)

  graph.zoom(0.9)
  graph.render()

  /* ~ Demo Actions ~ */
  // Start / Pause
  let isPaused = false
  const pauseButton = document.createElement('div')
  pauseButton.className = 'action'
  pauseButton.textContent = 'Pause'
  actionsDiv.appendChild(pauseButton)

  function pause (): void {
    isPaused = true
    pauseButton.textContent = 'Start'
    graph.pause()
  }

  function unpause (): void {
    isPaused = false
    pauseButton.textContent = 'Pause'
    // if the graph is at 100% progress, start the graph
    if (graph.progress === 1) {
      graph.start()
    } else {
      graph.unpause()
    }
  }

  function togglePause (): void {
    if (isPaused) unpause()
    else pause()
  }

  pauseButton.addEventListener('click', togglePause)
  graph.setConfig({
    onSimulationEnd: (): void => {
      pause()
    },
  })

  // Zoom and Highlight
  function getRandomPointIndex (): number {
    return Math.floor((Math.random() * pointPositions.length) / 2)
  }

  function getRandomInRange ([min, max]: [number, number]): number {
    return Math.random() * (max - min) + min
  }

  function fitView (): void {
    graph.fitView()
  }

  function zoomIn (): void {
    const pointIndex = getRandomPointIndex()
    graph.zoomToPointByIndex(pointIndex)
    graph.setConfig({ highlightedPointIndices: [pointIndex], highlightedLinkIndices: [] })
    pause()
  }

  function highlightPoint (): void {
    const pointIndex = getRandomPointIndex()
    graph.setConfig({ highlightedPointIndices: [pointIndex], highlightedLinkIndices: [] })
    graph.fitView()
    pause()
  }

  async function highlightPointsInArea (): Promise<void> {
    const w = div.clientWidth
    const h = div.clientHeight
    const left = getRandomInRange([w / 4, w / 2])
    const right = getRandomInRange([left, (w * 3) / 4])
    const top = getRandomInRange([h / 4, h / 2])
    const bottom = getRandomInRange([top, (h * 3) / 4])
    pause()
    const indices = await graph.findPointsInRect([
      [left, top],
      [right, bottom],
    ])
    const highlightedLinkIndices = graph.getAdjacentLinkIndices(indices)
    graph.setConfig({ highlightedPointIndices: indices, highlightedLinkIndices })
  }

  const fitViewButton = document.createElement('div')
  fitViewButton.className = 'action'
  fitViewButton.textContent = 'Fit View'
  fitViewButton.addEventListener('click', fitView)
  actionsDiv.appendChild(fitViewButton)

  const zoomButton = document.createElement('div')
  zoomButton.className = 'action'
  zoomButton.textContent = 'Zoom to a point'
  zoomButton.addEventListener('click', zoomIn)
  actionsDiv.appendChild(zoomButton)

  const highlightPointButton = document.createElement('div')
  highlightPointButton.className = 'action'
  highlightPointButton.textContent = 'Highlight a point'
  highlightPointButton.addEventListener('click', highlightPoint)
  actionsDiv.appendChild(highlightPointButton)

  const highlightPointsInAreaButton = document.createElement('div')
  highlightPointsInAreaButton.className = 'action'
  highlightPointsInAreaButton.textContent = 'Highlight points in a rectangular area'
  highlightPointsInAreaButton.addEventListener('click', highlightPointsInArea)
  actionsDiv.appendChild(highlightPointsInAreaButton)

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
