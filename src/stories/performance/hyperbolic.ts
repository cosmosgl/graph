import { Graph, type GraphConfig } from '@cosmos.gl/graph'

import { generateHyperbolicGraph } from '../utils'

const SPACE_SIZE = 4096
const LINK_DEFAULT_WIDTH = 1

/**
 * Hyperbolic stress test — a synthetic large graph (~140k points, ~1M links)
 * generated on the fly with a Hyperbolic Random Graph model (see
 * `generateHyperbolicGraph`). Points are colored by their angular sector
 * (emergent communities), sized by degree (hubs are larger), and start from a
 * native disk layout that the GPU simulation refines.
 */
export const hyperbolicStressTest = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  let linkBlending = false

  // Start / pause control for the simulation.
  const toggleButton = document.createElement('button')
  toggleButton.textContent = 'Pause'
  toggleButton.style.cssText = [
    'position: absolute',
    'top: 12px',
    'left: 12px',
    'z-index: 1000',
    'padding: 6px 16px',
    'font: 600 13px Helvetica, Arial, sans-serif',
    'color: #fff',
    'background: #5f69de',
    'border: none',
    'border-radius: 15px',
    'cursor: pointer',
    'opacity: 0.9',
  ].join(';')
  div.appendChild(toggleButton)

  const linkBlendingButton = document.createElement('button')
  linkBlendingButton.textContent = 'Link blending: Off'
  linkBlendingButton.style.cssText = [
    'position: absolute',
    'top: 48px',
    'left: 12px',
    'z-index: 1000',
    'padding: 6px 16px',
    'font: 600 13px Helvetica, Arial, sans-serif',
    'color: #fff',
    'background: #5f69de',
    'border: none',
    'border-radius: 15px',
    'cursor: pointer',
    'opacity: 0.9',
  ].join(';')
  div.appendChild(linkBlendingButton)

  const { pointPositions, pointColors, pointSizes, links } = generateHyperbolicGraph({
    nodeCount: 140_000,
    avgDegree: 14,
    alpha: 0.75,
    spaceSize: SPACE_SIZE,
    seed: 42,
  })

  const config: GraphConfig = {
    spaceSize: SPACE_SIZE,
    backgroundColor: '#2d313a',
    pointDefaultSize: 1.5,
    scalePointsOnZoom: true,
    renderLinks: true,
    linkDefaultColor: '#5F74C2',
    linkDefaultWidth: LINK_DEFAULT_WIDTH,
    linkGreyoutOpacity: 0,
    linkBlending,
    curvedLinks: false,
    enableDrag: false,
    fitViewOnInit: true,
    fitViewDelay: 5000,
    simulationFriction: 0.85,
    simulationLinkSpring: 1,
    simulationLinkDistance: 10,
    simulationRepulsion: 0.5,
    simulationGravity: 0.25,
    simulationDecay: 100000,
    showFPSMonitor: true,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(div, config)

  graph.setPointPositions(pointPositions)
  graph.setPointColors(pointColors)
  graph.setPointSizes(pointSizes)
  graph.setLinks(links)
  graph.render()
  graph.start()

  toggleButton.addEventListener('click', () => {
    if (graph.isSimulationRunning) {
      graph.pause()
      toggleButton.textContent = 'Start'
    } else {
      graph.unpause()
      toggleButton.textContent = 'Pause'
    }
  })

  linkBlendingButton.addEventListener('click', () => {
    linkBlending = !linkBlending
    graph.setConfigPartial({
      linkBlending,
      linkDefaultWidth: linkBlending ? LINK_DEFAULT_WIDTH : LINK_DEFAULT_WIDTH / 2,
    })
    linkBlendingButton.textContent = `Link blending: ${linkBlending ? 'On' : 'Off'}`
  })

  return { div, graph }
}
