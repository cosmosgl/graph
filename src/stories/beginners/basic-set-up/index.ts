import { Graph } from '@cosmos.gl/graph'
import { generateData } from './data-gen'
import './style.css'

export const basicSetUp = (): { graph: Graph; div: HTMLDivElement} => {
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
    pointSize: 4,
    pointColor: '#4B5BBF',
    linkWidth: 0.6,
    scalePointsOnZoom: true,
    linkColor: '#5F74C2',
    linkArrows: false,
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
      graph.selectPointByIndex(index)
      graph.zoomToPointByIndex(index)
      console.log('Clicked point index: ', index)
    },
    onBackgroundClick: (): void => {
      graph.unselectPoints()
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

  // Zoom and Select
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
    graph.selectPointByIndex(pointIndex)
    pause()
  }

  function selectPoint (): void {
    const pointIndex = getRandomPointIndex()
    graph.selectPointByIndex(pointIndex)
    graph.fitView()
    pause()
  }

  function selectPointsInArea (): void {
    const w = div.clientWidth
    const h = div.clientHeight
    const left = getRandomInRange([w / 4, w / 2])
    const right = getRandomInRange([left, (w * 3) / 4])
    const top = getRandomInRange([h / 4, h / 2])
    const bottom = getRandomInRange([top, (h * 3) / 4])
    pause()
    graph.selectPointsInRect([
      [left, top],
      [right, bottom],
    ])
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

  const selectPointButton = document.createElement('div')
  selectPointButton.className = 'action'
  selectPointButton.textContent = 'Select a point'
  selectPointButton.addEventListener('click', selectPoint)
  actionsDiv.appendChild(selectPointButton)

  const selectPointsInAreaButton = document.createElement('div')
  selectPointsInAreaButton.className = 'action'
  selectPointsInAreaButton.textContent = 'Select points in a rectangular area'
  selectPointsInAreaButton.addEventListener('click', selectPointsInArea)
  actionsDiv.appendChild(selectPointsInAreaButton)

  return { div, graph }
}
