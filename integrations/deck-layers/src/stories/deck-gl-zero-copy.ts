import { Deck, OrthographicView, type PickingInfo } from '@deck.gl/core'
import { defaultConfigValues, type GraphSimulation } from '@cosmos.gl/graph'
import { CosmosGraphLayer, type CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'

import { generateMeshData } from '@/graph/stories/generate-mesh-data'

/**
 * Shared-device, zero-copy deck.gl integration.
 *
 * deck.gl owns the canvas, the luma.gl device, and the frame lifecycle;
 * `CosmosGraphLayer` owns everything cosmos: it creates the `GraphSimulation`
 * on deck's device, ingests the flat typed arrays, steps the simulation once
 * per frame from deck's timeline while it runs, and lets deck go idle when it
 * settles — no render-loop wiring, no `_animate`, no device plumbing in
 * application code. Positions never leave the GPU: the layers sample the live
 * position texture.
 *
 * Hovering highlights the element under the cursor — point or link — and
 * shows which one, even while the simulation is moving. Dragging a point
 * grabs it: pinned under the pointer, with the simulation reheating so the
 * graph responds around it.
 */
export const deckGlZeroCopy = async (): Promise<{ div: HTMLDivElement; graph?: GraphSimulation; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const data = generateMeshData(100, 100, 25, 1.0)
  const spaceSize = defaultConfigValues.spaceSize

  const hoverStatus = document.createElement('div')
  hoverStatus.textContent = 'hover to inspect — drag a point to move it'
  hoverStatus.style.cssText =
    'position: absolute; top: 12px; right: 12px; z-index: 1; padding: 6px 12px; ' +
    'font: 12px monospace; color: #fff; background: rgba(0, 0, 0, 0.5); border-radius: 4px;'
  div.appendChild(hoverStatus)

  // The layer hands out its simulation for advanced control — here, restarting
  let simulation: GraphSimulation | undefined

  const deck = new Deck({
    parent: div,
    views: new OrthographicView(),
    initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -2.4, minZoom: -5, maxZoom: 2 },
    controller: true,
    // Points are small — give hover and click a little tolerance
    pickingRadius: 5,
    getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    layers: [
      new CosmosGraphLayer({
        id: 'cosmos-graph',
        points: { length: data.pointPositions.length / 2, initialPositions: data.pointPositions },
        links: data.links,
        getPointSize: 4,
        simulationConfig: {
          spaceSize,
          // Enough gravity to keep the relaxed lattice inside the space — with less,
          // repulsion expands it into the space-boundary clamp and it piles up on the walls
          simulationGravity: 0.15,
          simulationRepulsion: 0.5,
          simulationLinkDistance: 1,
          simulationLinkSpring: 2,
          simulationFriction: 0.7,
          simulationDecay: 5000,
        },
        onSimulationCreated: (sim): void => { simulation = sim },
        pickable: true,
        enablePointDrag: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 220],
        onHover: (info: PickingInfo): void => {
          const { elementType, index } = info as CosmosGraphPickingInfo
          hoverStatus.textContent = index >= 0 ? `${elementType} ${index}` : 'hover to inspect — drag a point to move it'
        },
      }),
    ],
  })

  const restartButton = document.createElement('button')
  restartButton.textContent = 'Restart simulation'
  restartButton.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 1; padding: 6px 12px; cursor: pointer;'
  restartButton.addEventListener('click', () => {
    simulation?.start()
  })
  div.appendChild(restartButton)

  return {
    div,
    // The layer owns the simulation: deck.finalize() finalizes the layer,
    // which destroys it
    destroy: (): void => deck.finalize(),
  }
}
