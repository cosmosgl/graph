import { Deck, OrthographicView, type PickingInfo } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { GraphSimulation, defaultConfigValues } from '@cosmos.gl/graph'
import { CosmosPointsLayer, CosmosLinksLayer } from '@cosmos.gl/deck-layers'

import { generateMeshData } from '../generate-mesh-data'

/**
 * Shared-device, zero-copy deck.gl integration.
 *
 * deck.gl owns the canvas, the luma.gl device, and the frame lifecycle. cosmos.gl
 * contributes only its extracted simulation class — `GraphSimulation`, no canvas,
 * no DOM, no render loop — running on deck's device and advanced one `step()` per
 * deck.gl frame from `onBeforeRender`. Custom layers sample the live GPU position
 * texture by point index: positions never leave the GPU, there is one canvas and
 * one device.
 *
 * The points layer joins deck's picking pass: hovering highlights the point
 * under the cursor and shows its index — even while the simulation is moving,
 * because picking samples the same live texture the draw does.
 */
export const deckGlZeroCopy = async (): Promise<{ div: HTMLDivElement; graph: GraphSimulation; destroy: () => void }> => {
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
      // Points are small — give hover and click a little tolerance
      pickingRadius: 5,
      getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      onDeviceInitialized: resolve,
      layers: [],
    })
  })

  const hoverStatus = document.createElement('div')
  hoverStatus.textContent = 'hover a point'
  hoverStatus.style.cssText =
    'position: absolute; top: 12px; right: 12px; z-index: 1; padding: 6px 12px; ' +
    'font: 12px monospace; color: #fff; background: rgba(0, 0, 0, 0.5); border-radius: 4px;'
  div.appendChild(hoverStatus)

  const graph = new GraphSimulation({
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
  graph.applyData()
  await graph.ready

  deck.setProps({
    // One cosmos.gl simulation step per deck.gl frame — deck owns the scheduler
    onBeforeRender: () => {
      if (graph.isSimulationRunning) graph.step()
    },
    layers: [
      new CosmosLinksLayer({
        id: 'cosmos-links',
        graph,
        // The cosmos links array is [src0, tgt0, src1, tgt1, …] — deck reads
        // it directly as two interleaved binary attributes, no copy
        data: {
          length: data.links.length / 2,
          attributes: {
            getLinkSource: { value: data.links, size: 1, stride: 8 },
            getLinkTarget: { value: data.links, size: 1, offset: 4, stride: 8 },
          },
        },
      }),
      new CosmosPointsLayer({
        id: 'cosmos-points',
        graph,
        data: { length: data.pointPositions.length / 2 },
        getPointSize: 4,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 220],
        onHover: (info: PickingInfo): void => {
          hoverStatus.textContent = info.index >= 0 ? `point ${info.index}` : 'hover a point'
        },
      }),
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
      // The device belongs to deck.gl: tear the simulation down first (it skips
      // destroying the external device), then let deck.finalize() destroy it.
      graph.destroy()
      deck.finalize()
    },
  }
}
