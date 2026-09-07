import { describe, it, expect } from 'vitest'
import { Deck, OrthographicView } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { GraphSimulation } from '@cosmos.gl/graph'
import { CosmosPointsLayer } from '@cosmos.gl/deck-layers'

/**
 * Runtime contract tests for @cosmos.gl/deck-layers: the layers render a live
 * GraphSimulation on deck.gl's device and participate in deck's picking pass —
 * the picked index is the point index.
 */

const WIDTH = 200
const HEIGHT = 200
// Points at known space coordinates; the view targets (1000, 1000) at zoom 0,
// so world units map 1:1 to pixels around the canvas centre.
const POSITIONS = new Float32Array([1000, 1000, 1050, 1000])

const createDeckWithSimulation = async (): Promise<{
  deck: Deck<OrthographicView>;
  graph: GraphSimulation;
  container: HTMLDivElement;
}> => {
  const container = document.createElement('div')
  container.style.width = `${WIDTH}px`
  container.style.height = `${HEIGHT}px`
  document.body.appendChild(container)

  let deck!: Deck<OrthographicView>
  const devicePromise = new Promise<Device>((resolve) => {
    deck = new Deck({
      parent: container,
      width: WIDTH,
      height: HEIGHT,
      views: new OrthographicView(),
      initialViewState: { target: [1000, 1000, 0], zoom: 0 },
      controller: false,
      onDeviceInitialized: resolve,
      layers: [],
    })
  })

  const graph = new GraphSimulation({}, devicePromise)
  graph.setPointPositions(POSITIONS, true)
  graph.applyData()
  await graph.ready
  return { deck, graph, container }
}

const waitFrames = (count: number): Promise<void> => new Promise((resolve) => {
  let remaining = count
  const tick = (): void => {
    remaining -= 1
    if (remaining <= 0) resolve()
    else requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

describe('CosmosPointsLayer', () => {
  it('renders points from the live position texture and picks them by index', async () => {
    const { deck, graph, container } = await createDeckWithSimulation()
    try {
      deck.setProps({
        layers: [
          new CosmosPointsLayer({
            id: 'points',
            graph,
            data: { length: POSITIONS.length / 2 },
            getPointSize: 10,
            pickable: true,
          }),
        ],
      })
      await waitFrames(10)

      // Point 0 sits at the view target — the canvas centre
      const center = deck.pickObject({ x: WIDTH / 2, y: HEIGHT / 2, radius: 2 })
      expect(center?.index).toBe(0)

      // Point 1 is 50 world units (= 50 px at zoom 0) to the right
      const offset = deck.pickObject({ x: WIDTH / 2 + 50, y: HEIGHT / 2, radius: 2 })
      expect(offset?.index).toBe(1)

      // Empty space picks nothing
      const empty = deck.pickObject({ x: 20, y: 20, radius: 2 })
      expect(empty).toBeNull()
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('returns the original datum from picking in accessor mode', async () => {
    const { deck, graph, container } = await createDeckWithSimulation()
    try {
      const points = [{ label: 'first' }, { label: 'second' }]
      deck.setProps({
        layers: [
          new CosmosPointsLayer<{ label: string }>({
            id: 'points',
            graph,
            data: points,
            getPointSize: 10,
            getPointColor: [255, 0, 0, 255],
            pickable: true,
          }),
        ],
      })
      await waitFrames(10)

      const info = deck.pickObject({ x: WIDTH / 2 + 50, y: HEIGHT / 2, radius: 2 })
      expect(info?.object).toEqual({ label: 'second' })
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })
})
