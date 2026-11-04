import { Graph } from '@cosmos.gl/graph'
import { CosmosLabels } from './labels'
import { processPerformances, pointsToShowLabelsFor } from './data'
import './style.css'

// Load data from Github Gist and use it as `performances` argument for `PointLabelsStory`:
// const data = await fetch('https://gist.githubusercontent.com/Stukova/e6c4c7777e0166431a983999213f10c8/raw/performances.json')
// const performances = await data.json()

export const pointLabels = (
  performances: {
    theaterCode: string;
    performanceTitle: string;
    theaterName: string;
  }[]
): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const { pointPositions, pointColors, pointSizes, links, pointIndexToLabel, pointLabelToIndex } = processPerformances(performances)
  const div = document.createElement('div')
  div.className = 'point-labels-story'

  const modes = [
    ['tracked', 'Tracked'],
    ['non-blocking', 'Non-blocking'],
    ['synchronous', 'Synchronous'],
  ] as const
  let labelMode: typeof modes[number][0] = 'non-blocking'

  const options = document.createElement('div')
  options.className = 'point-label-options'
  options.setAttribute('role', 'radiogroup')
  options.setAttribute('aria-label', 'Label mode')
  for (const [mode, text] of modes) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'point-label-mode'
    input.checked = mode === labelMode
    input.addEventListener('change', () => {
      labelMode = mode
      updateLabelMode()
    })
    const caption = document.createElement('span')
    caption.textContent = text
    label.append(input, caption)
    options.appendChild(label)
  }

  div.appendChild(options)

  const labelsDiv = document.createElement('div')
  div.appendChild(labelsDiv)

  const graphDiv = document.createElement('div')
  graphDiv.className = 'point-labels-graph'
  div.appendChild(graphDiv)

  const cosmosLabels = new CosmosLabels(labelsDiv, pointIndexToLabel)

  const drawTrackedLabels = (): void => {
    if (labelMode === 'tracked') cosmosLabels.update(graph, graph.getTrackedPointPositionsMap())
  }

  const graph = new Graph(graphDiv, {
    spaceSize: 4096,
    backgroundColor: '#2d313a',
    scalePointsOnZoom: true,
    linkDefaultWidth: 0.6,
    linkDefaultColor: '#5F74C2',
    linkDefaultArrows: false,
    fitViewOnInit: false,
    enableDrag: true,
    simulationGravity: 0.1,
    simulationLinkDistance: 1,
    simulationLinkSpring: 0.3,
    simulationRepulsion: 0.4,
    onSimulationTick: drawTrackedLabels,
    onZoom: drawTrackedLabels,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  })

  graph.setPointPositions(new Float32Array(pointPositions))
  graph.setPointColors(new Float32Array(pointColors))
  graph.setPointSizes(new Float32Array(pointSizes))
  graph.setLinks(new Float32Array(links))
  graph.render()
  graph.setZoomLevel(0.6)

  // _Track the points_ for which you wish to display labels.
  // Their coordinates in the simulation space will be accessible
  // via the `getTrackedPointPositionsMap` method. You can then convert
  // them to the screen space with the `spaceToScreenPosition`
  // method.
  graph.trackPointPositionsByIndices(
    pointsToShowLabelsFor.map((l) => pointLabelToIndex.get(l) as number)
  )

  let frame = 0
  const drawSampledLabels = (): void => {
    const positions = labelMode === 'non-blocking'
      ? graph.getSampledPointPositionsMap({ nonBlocking: true })
      : graph.getSampledPointPositionsMap()
    cosmosLabels.update(graph, positions)
    frame = requestAnimationFrame(drawSampledLabels)
  }
  const updateLabelMode = (): void => {
    cancelAnimationFrame(frame)
    if (labelMode === 'tracked') drawTrackedLabels()
    else frame = requestAnimationFrame(drawSampledLabels)
  }
  frame = requestAnimationFrame(drawSampledLabels)

  return { div, graph, destroy: () => cancelAnimationFrame(frame) }
}
