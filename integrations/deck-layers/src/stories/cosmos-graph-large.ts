import { Deck, OrthographicView, type PickingInfo } from '@deck.gl/core'
import { defaultConfigValues, type GraphSimulation } from '@cosmos.gl/graph'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'

import { generateMeshData } from '@/graph/stories/generate-mesh-data'

/**
 * The zero-copy payoff at scale: a ~100,000-point mesh with ~200,000 links,
 * per-point colors and sizes — all binary. Positions live in the simulation's
 * GPU texture and never reach the CPU; colors and sizes are the generator's
 * arrays handed to deck as binary attributes; the links array feeds both the
 * simulation and the renderer without a copy. Hover and drag still work — the
 * picking pass samples the same live texture.
 */
export const cosmosGraphLarge = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  // ~100k points: a 316×316 mesh
  const data = generateMeshData(316, 316, 25, 1.0)
  const pointCount = data.pointPositions.length / 2
  const linkCount = data.links.length / 2
  const spaceSize = defaultConfigValues.spaceSize

  // cosmos channels are 0..1 floats; deck attributes take 0..255 bytes
  const pointColors = Uint8Array.from(data.pointColors, (channel) => channel * 255)

  const counts = `${pointCount.toLocaleString()} points · ${linkCount.toLocaleString()} links`
  const status = document.createElement('div')
  status.textContent = counts
  status.style.cssText =
    'position: absolute; top: 12px; right: 12px; z-index: 1; padding: 6px 12px; ' +
    'font: 12px monospace; color: #fff; background: rgba(0, 0, 0, 0.5); border-radius: 4px;'
  div.appendChild(status)

  let simulation: GraphSimulation | undefined

  const deck = new Deck({
    parent: div,
    views: new OrthographicView(),
    initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -2.8, minZoom: -5, maxZoom: 2 },
    controller: true,
    pickingRadius: 4,
    getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    layers: [
      new CosmosGraphLayer({
        id: 'cosmos-large',
        points: {
          length: pointCount,
          initialPositions: data.pointPositions,
          // zero-copy styling: the generator's channel arrays feed deck directly
          attributes: {
            getPointColor: { value: pointColors, size: 4 },
            getPointSize: { value: data.pointSizes, size: 1 },
          },
        },
        links: data.links,
        getLinkColor: [120, 130, 190, 22],
        simulationConfig: {
          spaceSize,
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
        highlightColor: [255, 255, 255, 240],
        onHover: (info: PickingInfo): void => {
          status.textContent = info.index >= 0 ? `${counts} · point ${info.index}` : counts
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
    destroy: (): void => deck.finalize(),
  }
}
