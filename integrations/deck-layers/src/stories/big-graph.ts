import { Deck, OrthographicView } from '@deck.gl/core'
import type { PickingInfo } from '@deck.gl/core'
import { defaultConfigValues } from '@cosmos.gl/graph'
import type { Graph } from '@cosmos.gl/graph'
import { CosmosGraphLayer } from '@cosmos.gl/deck-layers'
import type { CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'

import { generateMeshData } from '@/graph/stories/generate-mesh-data'
import './style.css'

/**
 * The zero-copy payoff at scale: a ~100,000-point mesh with ~200,000 links,
 * per-point colors and sizes, per-link colors and widths — all cosmos.gl's
 * flat arrays, handed to the layer as binary attributes and to cosmos.gl as
 * they are. Positions live in the simulation's GPU texture and never reach
 * the CPU; cosmos.gl's own renderer draws every frame under deck's camera, and
 * draws its picking colors in deck's pick pass, so hover and drag work at scale.
 */
export const bigGraph = async (): Promise<{ div: HTMLDivElement; destroy: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  // ~100k points: a 316×316 mesh
  const data = generateMeshData(316, 316, 25, 1.0)
  const pointCount = data.pointPositions.length / 2
  const linkCount = data.links.length / 2
  const spaceSize = defaultConfigValues.spaceSize

  // The generator's channels are cosmos's 0..1 floats, passed through untouched —
  // the link alpha alone is lowered: 200k links want a light touch
  const linkColors = Float32Array.from(data.linkColors, (channel, i) => (i % 4 === 3 ? 0.1 : channel))

  const hover = document.createElement('div')
  hover.className = 'hover'
  hover.textContent = 'hover to see the picked element'
  div.appendChild(hover)
  const status = document.createElement('div')
  status.className = 'status'
  div.appendChild(status)

  let graph: Graph | undefined
  let isPaused = false
  const counts = `${pointCount.toLocaleString()} points · ${linkCount.toLocaleString()} links`
  const setStatus = (): void => {
    const state = graph?.isSimulationRunning ? 'running' : isPaused ? 'paused' : 'settled'
    status.textContent = `${counts} · ${state}`
  }

  const deck = new Deck({
    parent: div,
    views: new OrthographicView({ flipY: false }), // cosmos's space has y up
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
          // zero-copy styling: Float32Array channels reach cosmos as they are
          attributes: {
            getPointColor: { value: data.pointColors, size: 4 },
            getPointSize: { value: data.pointSizes, size: 1 },
          },
        },
        links: {
          pairs: data.links,
          attributes: {
            getLinkColor: { value: linkColors, size: 4 },
            getLinkWidth: { value: data.linkWidths, size: 1 },
          },
        },
        config: {
          spaceSize,
          simulationGravity: 0.15,
          simulationRepulsion: 0.5,
          simulationLinkDistance: 1,
          simulationLinkSpring: 2,
          simulationFriction: 0.7,
          simulationDecay: 5000,
        },
        onGraphCreated: (created): void => { graph = created },
        pickable: true,
        enablePointDrag: true,
        autoHighlight: true,
        onHover: (info: PickingInfo): void => {
          const picked = info as CosmosGraphPickingInfo
          hover.textContent = picked.index >= 0 ? `${picked.elementType} ${picked.index}` : 'hover to see the picked element'
        },
      }),
    ],
  })

  const actions = document.createElement('div')
  actions.className = 'actions'
  const actionsHeader = document.createElement('div')
  actionsHeader.className = 'actions-header'
  actionsHeader.textContent = 'Actions'
  actions.appendChild(actionsHeader)
  const makeAction = (label: string, onClick: () => void): HTMLDivElement => {
    const action = document.createElement('div')
    action.className = 'action'
    action.textContent = label
    action.addEventListener('click', onClick)
    actions.appendChild(action)
    return action
  }
  const pauseAction = makeAction('Pause', () => {
    if (!graph) return
    if (graph.isSimulationRunning) {
      graph.pause()
      isPaused = true
      pauseAction.textContent = 'Start'
    } else {
      graph.unpause()
      isPaused = false
      pauseAction.textContent = 'Pause'
    }
    setStatus()
  })
  makeAction('Reheat', () => {
    graph?.start()
    isPaused = false
    pauseAction.textContent = 'Pause'
    setStatus()
  })
  div.appendChild(actions)

  setStatus()
  // The status follows the simulation as it settles on its own
  const ticker = window.setInterval(setStatus, 500)

  return {
    div,
    destroy: (): void => {
      window.clearInterval(ticker)
      // The layer owns the graph: finalizing deck finalizes the layer, which destroys it
      deck.finalize()
    },
  }
}
