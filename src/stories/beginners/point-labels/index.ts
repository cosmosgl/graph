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
): { graph: Graph; div: HTMLDivElement} => {
  const { pointPositions, pointColors, pointSizes, links, pointIndexToLabel, pointLabelToIndex } = processPerformances(performances)
  const div = document.createElement('div')
  div.className = 'app'

  const labelsDiv = document.createElement('div')
  div.appendChild(labelsDiv)

  const graphDiv = document.createElement('div')
  graphDiv.className = 'graph'
  div.appendChild(graphDiv)

  const cosmosLabels = new CosmosLabels(labelsDiv, pointIndexToLabel)

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
    onSimulationTick: () => cosmosLabels.update(graph),
    onZoom: () => cosmosLabels.update(graph),
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

  return { div, graph }
}
