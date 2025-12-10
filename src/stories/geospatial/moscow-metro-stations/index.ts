import { Graph } from '@cosmos.gl/graph'
import { luma } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'
import { moscowMetroCoords } from './moscow-metro-coords'
import { getPointColors } from './point-colors'
import './style.css'

/**
 * This example demonstrates the importance of rescaling positions by Cosmos.
 * The Moscow Metro station coordinates are are normalized (0-1 range in both dimensions).
 * By default, cosmos.gl rescales these positions to fit the canvas.
 * When disabling rescaling (`rescalePositions: false`):
 * - Points render using raw coordinates
 * - The entire graph occupies a tiny 1x1 area in WebGL's clip space (-1 to 1)
 * - This causes visual artifacts due to WebGL's floating-point precision limitations
 * - Points cluster in the center and may exhibit rendering glitches
 */
export const moscowMetroStations = async (): Promise<{graph: Graph; div: HTMLDivElement; destroy?: () => void}> => {
  const div = document.createElement('div')
  div.className = 'app'

  const graphDiv = document.createElement('div')
  graphDiv.className = 'graph'
  div.appendChild(graphDiv)

  const actionsDiv = document.createElement('div')
  actionsDiv.className = 'actions'
  div.appendChild(actionsDiv)

  let rescalePositions = true

  const device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {
      container: graphDiv,
      useDevicePixels: true,
      autoResize: true,
    },
  })

  const graph = new Graph(graphDiv, device, {
    backgroundColor: '#2d313a',
    scalePointsOnZoom: false,
    rescalePositions,
    pointDefaultColor: '#FEE08B',
    enableSimulation: false,
    enableDrag: false,
    fitViewOnInit: true,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  })

  const pointColors = getPointColors(moscowMetroCoords)

  graph.setPointPositions(new Float32Array(moscowMetroCoords))
  graph.setPointColors(pointColors)
  graph.render()

  const disableEnableRescaleButton = document.createElement('div')
  disableEnableRescaleButton.className = 'action'
  disableEnableRescaleButton.textContent = 'Disable Rescale'
  actionsDiv.appendChild(disableEnableRescaleButton)

  disableEnableRescaleButton.addEventListener('click', () => {
    rescalePositions = !rescalePositions
    disableEnableRescaleButton.textContent = rescalePositions ? 'Disable Rescale' : 'Enable Rescale'
    graph.setConfig({ rescalePositions })
    graph.setPointPositions(new Float32Array(moscowMetroCoords))
    graph.render()
    graph.fitView()
  })

  const destroy = (): void => {
    graph.destroy()
    device.destroy()
  }

  return { div, graph, destroy }
}
