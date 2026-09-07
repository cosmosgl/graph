import { describe, it, expect } from 'vitest'
import { Deck, OrthographicView } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { GraphSimulation, type GraphSimulationConfig } from '@cosmos.gl/graph'
import { CosmosPointsLayer, CosmosLinksLayer } from '@cosmos.gl/deck-layers'

/**
 * Runtime contract tests for @cosmos.gl/deck-layers: the layers render a live
 * GraphSimulation on deck.gl's device and participate in deck's picking pass —
 * the picked index is the point index, and picking always reflects the
 * texture's current positions.
 */

const WIDTH = 200
const HEIGHT = 200
// Points at known space coordinates; the view targets (1000, 1000) at zoom 0,
// so world units map 1:1 to pixels around the canvas centre — and with
// OrthographicView's default flipY, world +y runs down the screen.
const POSITIONS = new Float32Array([1000, 1000, 1050, 1000, 1000, 1030])
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 }

const worldToScreen = (x: number, y: number): { x: number; y: number } =>
  ({ x: CENTER.x + (x - 1000), y: CENTER.y + (y - 1000) })

const createDeckWithSimulation = async (
  config: GraphSimulationConfig = {},
  positions: Float32Array = POSITIONS
): Promise<{
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

  const graph = new GraphSimulation(config, devicePromise)
  graph.setPointPositions(positions, true)
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

// Deck initializes and updates layers on its own animation frames; wait until
// the first pick lands instead of guessing a frame count, but stay bounded so
// a layer that never renders still fails loudly.
const waitUntilPickable = async (deck: Deck<OrthographicView>, maxFrames = 240): Promise<void> => {
  for (let i = 0; i < maxFrames; i += 1) {
    await waitFrames(1)
    if (deck.pickObject({ ...CENTER, radius: 2 })) return
  }
  throw new Error(`deck produced no pick at the canvas centre within ${maxFrames} frames`)
}

describe('CosmosPointsLayer', () => {
  it('picks points by index at their projected positions, on both axes', async () => {
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
      await waitUntilPickable(deck)

      // Point 0 sits at the view target — the canvas centre
      const center = deck.pickObject({ ...CENTER, radius: 2 })
      expect(center?.index).toBe(0)
      expect(center?.layer?.id).toBe('points')
      // The picked coordinate is the unprojected world position drag will rely on
      expect(center?.coordinate?.[0]).toBeCloseTo(1000, 0)
      expect(center?.coordinate?.[1]).toBeCloseTo(1000, 0)

      // Point 1 is 50 world units to the right (= 50 px at zoom 0)
      const right = deck.pickObject({ ...worldToScreen(1050, 1000), radius: 2 })
      expect(right?.index).toBe(1)

      // Point 2 pins the y convention: world +y is 30 px down the screen
      const below = deck.pickObject({ ...worldToScreen(1000, 1030), radius: 2 })
      expect(below?.index).toBe(2)

      // Empty space picks nothing
      const empty = deck.pickObject({ x: 20, y: 20, radius: 2 })
      expect(empty).toBeNull()
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('keeps picking in sync with the live texture as the simulation steps', async () => {
    // A lone link spring: deterministic, pulls the pair together along x, and
    // converges — the points can never leave the viewport.
    const { deck, graph, container } = await createDeckWithSimulation({
      simulationGravity: 0,
      simulationCenter: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 2,
      simulationLinkDistance: 10,
      simulationFriction: 0.85,
      simulationDecay: 1000,
      randomSeed: 1,
    }, new Float32Array([1000, 1000, 1050, 1000]))
    try {
      graph.setLinks(new Float32Array([0, 1]))
      graph.applyData()
      deck.setProps({
        layers: [
          new CosmosPointsLayer({ id: 'points', graph, data: { length: 2 }, getPointSize: 10, pickable: true }),
        ],
      })
      await waitUntilPickable(deck)

      for (let i = 0; i < 80; i += 1) graph.step()

      const after = graph.getPointPositionsArray()
      const [x0, y0] = [after[0] as number, after[1] as number]
      // Point 0 was pulled right toward its link partner — far enough to
      // leave the old pick radius, still inside the viewport (the spring
      // keeps distance, not order, and may overshoot the midpoint)
      expect(x0).toBeGreaterThan(1008)
      expect(x0).toBeLessThan(1090)

      // The CPU snapshot predicts the screen position; the picking pass must
      // agree, because both read the same live texture
      const screen = worldToScreen(x0, y0)
      const moved = deck.pickObject({ x: Math.round(screen.x), y: Math.round(screen.y), radius: 3 })
      expect(moved?.index).toBe(0)

      // The old position no longer picks point 0
      const old = deck.pickObject({ ...CENTER, radius: 2 })
      expect(old?.index ?? null).not.toBe(0)
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('returns the original datum from picking in accessor mode', async () => {
    const { deck, graph, container } = await createDeckWithSimulation()
    try {
      const points = [{ label: 'first' }, { label: 'second' }, { label: 'third' }]
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
      await waitUntilPickable(deck)

      const info = deck.pickObject({ ...worldToScreen(1050, 1000), radius: 2 })
      expect(info?.index).toBe(1)
      expect(info?.object).toEqual({ label: 'second' })
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('accepts binary attributes keyed by accessor name', async () => {
    const { deck, graph, container } = await createDeckWithSimulation()
    try {
      const binaryData = {
        length: POSITIONS.length / 2,
        attributes: {
          getPointSize: { value: new Float32Array([10, 10, 10]), size: 1 },
          getPointColor: { value: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), size: 4 },
        },
      }
      deck.setProps({
        layers: [
          new CosmosPointsLayer({ id: 'points', graph, data: binaryData, pickable: true }),
        ],
      })
      await waitUntilPickable(deck)

      const info = deck.pickObject({ ...worldToScreen(1050, 1000), radius: 2 })
      expect(info?.index).toBe(1)
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('neither renders nor picks a NaN-absent point', async () => {
    const { deck, graph, container } = await createDeckWithSimulation(
      {},
      new Float32Array([1000, 1000, NaN, NaN])
    )
    try {
      deck.setProps({
        layers: [
          new CosmosPointsLayer({ id: 'points', graph, data: { length: 2 }, getPointSize: 10, pickable: true }),
        ],
      })
      await waitUntilPickable(deck)

      // The present point picks normally; the absent one appears nowhere —
      // not at the centre, not at a collapsed-quad origin
      expect(deck.pickObject({ ...CENTER, radius: 2 })?.index).toBe(0)
      for (const probe of [{ x: 20, y: 20 }, { x: 180, y: 180 }, { x: 100, y: 180 }]) {
        expect(deck.pickObject({ ...probe, radius: 2 })?.index ?? null).not.toBe(1)
      }
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })
})

describe('CosmosLinksLayer', () => {
  it('picks links by link index along the extruded quad', async () => {
    const { deck, graph, container } = await createDeckWithSimulation(
      {},
      new Float32Array([1000, 1000, 1050, 1000])
    )
    try {
      // Cosmos-native links array read as two interleaved binary attributes
      const links = new Float32Array([0, 1])
      deck.setProps({
        layers: [
          new CosmosLinksLayer({
            id: 'links',
            graph,
            data: {
              length: 1,
              attributes: {
                getLinkSource: { value: links, size: 1, stride: 8 },
                getLinkTarget: { value: links, size: 1, offset: 4, stride: 8 },
              },
            },
            getLinkWidth: 8,
            pickable: true,
          }),
        ],
      })
      await waitUntilPickable(deck)

      const mid = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 })
      expect(mid?.index).toBe(0)
      expect(mid?.layer?.id).toBe('links')

      // The quad is extruded by half the width to each side: 3 px off the
      // centre line still hits at width 8, 8 px off misses
      const nearEdge = deck.pickObject({ x: worldToScreen(1025, 1000).x, y: CENTER.y - 3, radius: 0 })
      expect(nearEdge?.index).toBe(0)
      const outside = deck.pickObject({ x: worldToScreen(1025, 1000).x, y: CENTER.y - 8, radius: 0 })
      expect(outside).toBeNull()
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('resolves accessor-mode links through the default source/target accessors', async () => {
    const { deck, graph, container } = await createDeckWithSimulation(
      {},
      new Float32Array([1000, 1000, 1050, 1000])
    )
    try {
      const linkData = [{ source: 0, target: 1, label: 'only' }]
      deck.setProps({
        layers: [
          new CosmosLinksLayer({ id: 'links', graph, data: linkData, getLinkWidth: 8, pickable: true }),
        ],
      })
      await waitUntilPickable(deck)

      const info = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 })
      expect(info?.index).toBe(0)
      expect(info?.object).toEqual({ source: 0, target: 1, label: 'only' })
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })
})
