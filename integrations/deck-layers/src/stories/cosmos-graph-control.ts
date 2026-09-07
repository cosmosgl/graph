import { Deck, OrthographicView } from '@deck.gl/core'
import { defaultConfigValues, type GraphSimulation } from '@cosmos.gl/graph'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'

import { generateMeshData } from '@/graph/stories/generate-mesh-data'

/**
 * Simulation control through `onSimulationCreated`, and one layer in two
 * viewports. The buttons pause, resume, reheat, and pin the mesh corners
 * through the layer-owned simulation; the minimap is a second
 * `OrthographicView` rendering the same layer — the position texture is
 * sampled once per viewport, while the simulation still steps exactly once
 * per frame from deck's timeline.
 */
export const cosmosGraphControl = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const size = 60
  const data = generateMeshData(size, size, 8, 1.0)
  const pointCount = data.pointPositions.length / 2
  const cornerIndices = [0, size - 1, pointCount - size, pointCount - 1]
  const spaceSize = defaultConfigValues.spaceSize

  const status = document.createElement('div')
  status.textContent = 'running'
  status.style.cssText =
    'position: absolute; bottom: 12px; left: 12px; z-index: 1; padding: 6px 12px; ' +
    'font: 12px monospace; color: #fff; background: rgba(0, 0, 0, 0.5); border-radius: 4px;'
  div.appendChild(status)

  let simulation: GraphSimulation | undefined
  let cornersPinned = false

  const deck = new Deck({
    parent: div,
    views: [
      new OrthographicView({ id: 'main', controller: true }),
      new OrthographicView({ id: 'minimap', x: '72%', y: '4%', width: '24%', height: '24%' }),
    ],
    initialViewState: {
      main: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -1.6, minZoom: -5, maxZoom: 2 },
      minimap: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -3.4 },
    },
    getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    pickingRadius: 5,
    layers: [
      new CosmosGraphLayer({
        id: 'cosmos-control',
        points: { length: pointCount, initialPositions: data.pointPositions },
        links: data.links,
        getPointSize: 4,
        simulationConfig: {
          spaceSize,
          simulationGravity: 0.15,
          simulationRepulsion: 0.5,
          simulationLinkDistance: 1,
          simulationLinkSpring: 2,
          simulationFriction: 0.7,
          simulationDecay: 5000,
          onSimulationEnd: (): void => { status.textContent = 'settled' },
        },
        onSimulationCreated: (sim): void => { simulation = sim },
        pickable: true,
        enablePointDrag: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 220],
      }),
    ],
  })

  const controls = document.createElement('div')
  controls.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 1; display: flex; gap: 8px;'
  const makeButton = (label: string, onClick: () => void): void => {
    const button = document.createElement('button')
    button.textContent = label
    button.style.cssText = 'padding: 6px 12px; cursor: pointer;'
    button.addEventListener('click', onClick)
    controls.appendChild(button)
  }
  makeButton('Pause', () => { simulation?.pause(); status.textContent = 'paused' })
  makeButton('Resume', () => { simulation?.unpause(); status.textContent = 'running' })
  makeButton('Reheat', () => { simulation?.start(0.3); status.textContent = 'running' })
  makeButton('Pin corners', () => {
    cornersPinned = !cornersPinned
    simulation?.setPinnedPoints(cornersPinned ? cornerIndices : null)
    simulation?.start(0.3)
    status.textContent = cornersPinned ? 'running · corners pinned' : 'running'
  })
  div.appendChild(controls)

  return {
    div,
    destroy: (): void => deck.finalize(),
  }
}
