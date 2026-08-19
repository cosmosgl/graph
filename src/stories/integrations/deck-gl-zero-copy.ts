import { Deck, OrthographicView } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { Graph, defaultConfigValues } from '@cosmos.gl/graph'

import { generateMeshData } from '../generate-mesh-data'
import { CosmosPointsLayer, CosmosLinksLayer } from './cosmos-deck-layers'

/**
 * Shared-device, zero-copy deck.gl integration.
 *
 * deck.gl owns the canvas, the luma.gl device, and the frame lifecycle. cosmos.gl
 * runs **headless** on the same device (`new Graph(null, config, devicePromise)`)
 * and is advanced one `step()` per deck.gl frame from `onBeforeRender`. Custom
 * layers sample the live GPU position texture by point index — positions never
 * leave the GPU, there is one canvas, one device, and no cosmos.gl render loop.
 */
export const deckGlZeroCopy = async (): Promise<{ div: HTMLDivElement; graph: Graph; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const data = generateMeshData(100, 100, 25, 1.0)
  const spaceSize = defaultConfigValues.spaceSize

  // deck.gl creates the device; cosmos.gl receives it as an external device it
  // must never clear, submit, resize, or reparent.
  let deck!: Deck<OrthographicView>
  const devicePromise = new Promise<Device>((resolve) => {
    deck = new Deck({
      parent: div,
      views: new OrthographicView(),
      initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -2.4, minZoom: -5, maxZoom: 2 },
      controller: true,
      // Render every frame while the simulation runs; onBeforeRender below
      // (set once the graph exists) advances it from deck's frame lifecycle
      _animate: true,
      onDeviceInitialized: resolve,
      layers: [],
    })
  })

  const graph = new Graph(null, {
    spaceSize,
    // Enough gravity to keep the relaxed lattice inside the space — with less,
    // repulsion expands it into the space-boundary clamp and it piles up on the walls
    simulationGravity: 0.15,
    simulationRepulsion: 0.5,
    simulationLinkDistance: 1,
    simulationLinkSpring: 2,
    simulationFriction: 0.7,
    simulationDecay: 5000,
    // The simulation settled — stop deck's continuous rendering; controller
    // interactions keep redrawing from the final texture on demand
    onSimulationEnd: () => deck.setProps({ _animate: false }),
  }, devicePromise)

  graph.setPointPositions(data.pointPositions)
  graph.setLinks(data.links)
  graph.render()
  await graph.ready

  deck.setProps({
    // One cosmos.gl simulation step per deck.gl frame — deck owns the scheduler
    onBeforeRender: () => {
      if (graph.isSimulationRunning) graph.step()
    },
    layers: [
      new CosmosLinksLayer({ id: 'cosmos-links', graph, links: data.links }),
      new CosmosPointsLayer({ id: 'cosmos-points', graph, pointSize: 4 }),
    ],
  })

  const restartButton = document.createElement('button')
  restartButton.textContent = 'Restart simulation'
  restartButton.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 1; padding: 6px 12px; cursor: pointer;'
  restartButton.addEventListener('click', () => {
    graph.start()
    deck.setProps({ _animate: true })
  })
  div.appendChild(restartButton)

  return {
    div,
    graph,
    destroy: (): void => {
      // The device belongs to deck.gl: tear the graph down first (it skips
      // destroying the external device), then let deck.finalize() destroy it.
      graph.destroy()
      deck.finalize()
    },
  }
}
