import { Deck, OrthographicView, COORDINATE_SYSTEM } from '@deck.gl/core'
import { ScatterplotLayer, LineLayer } from '@deck.gl/layers'
import { Graph, defaultConfigValues } from '@cosmos.gl/graph'

import { generateMeshData } from '../generate-mesh-data'

/** Minimum time between position readbacks, in milliseconds. */
const SNAPSHOT_INTERVAL_MS = 100

/**
 * CPU-readback deck.gl integration (the `CosmosLayout` pattern).
 *
 * cosmos.gl runs **headless** as a pure layout engine — no div, no canvas of its
 * own — while regular deck.gl layers (`ScatterplotLayer`, `LineLayer`) render the
 * graph. Positions cross to the CPU through the asynchronous, non-stalling
 * `getPointPositionsAsync()`, throttled to one snapshot per SNAPSHOT_INTERVAL_MS.
 *
 * This mode trades cosmos.gl's GPU-resident scale for compatibility with stock
 * deck.gl layers; see the zero-copy story for the architecture that keeps
 * positions on the GPU.
 */
export const deckGlReadback = (): { div: HTMLDivElement; graph: Graph; destroy: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const data = generateMeshData(50, 40, 15, 1.0)
  const pointCount = Math.floor(data.pointPositions.length / 2)
  const linkCount = Math.floor(data.links.length / 2)
  const spaceSize = defaultConfigValues.spaceSize

  // Positions the deck.gl layers read from; starts at the input layout so the
  // first frame shows something before the first snapshot lands
  let positions: Float32Array = Float32Array.from(data.pointPositions)
  let snapshotVersion = 0

  const deck = new Deck({
    parent: div,
    views: new OrthographicView(),
    initialViewState: { target: [spaceSize / 2, spaceSize / 2, 0], zoom: -2.4, minZoom: -5, maxZoom: 2 },
    controller: true,
    layers: [],
  })

  const updateLayers = (): void => {
    deck.setProps({
      layers: [
        new LineLayer({
          id: 'graph-links',
          data: { length: linkCount },
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          getSourcePosition: (_, { index }): [number, number, number] => {
            const source = data.links[index * 2] as number
            return [positions[source * 2] as number, positions[source * 2 + 1] as number, 0]
          },
          getTargetPosition: (_, { index }): [number, number, number] => {
            const target = data.links[index * 2 + 1] as number
            return [positions[target * 2] as number, positions[target * 2 + 1] as number, 0]
          },
          getColor: [95, 116, 194, 60],
          getWidth: 1,
          widthUnits: 'pixels',
          updateTriggers: { getSourcePosition: snapshotVersion, getTargetPosition: snapshotVersion },
        }),
        new ScatterplotLayer({
          id: 'graph-points',
          data: { length: pointCount },
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          getPosition: (_, { index }): [number, number, number] => [positions[index * 2] as number, positions[index * 2 + 1] as number, 0],
          getFillColor: [75, 91, 191, 230],
          getRadius: 2.5,
          radiusUnits: 'pixels',
          updateTriggers: { getPosition: snapshotVersion },
        }),
      ],
    })
  }
  updateLayers()

  // Headless, no div: cosmos.gl creates its own hidden device and runs as a pure
  // simulation. The story's rAF loop below drives it — a headless instance never
  // schedules frames on its own.
  let lastSnapshotTime = 0
  let readbackInFlight = false
  const takeSnapshot = (): void => {
    if (readbackInFlight) return
    readbackInFlight = true
    lastSnapshotTime = performance.now()
    // Asynchronous readback: the copy runs on the GPU timeline, no CPU stall.
    // Reuses the `positions` array as the destination to avoid reallocation.
    graph.getPointPositionsAsync(positions).then((snapshot) => {
      readbackInFlight = false
      if (snapshot.length === 0) return
      positions = snapshot
      snapshotVersion += 1
      updateLayers()
    }).catch(() => { readbackInFlight = false })
  }

  const graph = new Graph(null, {
    spaceSize,
    simulationGravity: 0.02,
    simulationRepulsion: 0.5,
    simulationLinkDistance: 1,
    simulationLinkSpring: 2,
    simulationFriction: 0.7,
    simulationDecay: 10000,
    onSimulationTick: (): void => {
      if (performance.now() - lastSnapshotTime >= SNAPSHOT_INTERVAL_MS) takeSnapshot()
    },
    // Final snapshot so the rendered layout matches the settled simulation
    onSimulationEnd: () => takeSnapshot(),
  })

  graph.setPointPositions(data.pointPositions)
  graph.setLinks(data.links)
  graph.render()

  let animationFrameId = 0
  const tick = (): void => {
    if (graph.isSimulationRunning) graph.step()
    animationFrameId = window.requestAnimationFrame(tick)
  }
  animationFrameId = window.requestAnimationFrame(tick)

  const restartButton = document.createElement('button')
  restartButton.textContent = 'Restart simulation'
  restartButton.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 1; padding: 6px 12px; cursor: pointer;'
  restartButton.addEventListener('click', () => graph.start())
  div.appendChild(restartButton)

  return {
    div,
    graph,
    destroy: (): void => {
      window.cancelAnimationFrame(animationFrameId)
      deck.finalize()
    },
  }
}
