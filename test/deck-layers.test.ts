import { describe, it, expect, vi } from 'vitest'
import { Deck, OrthographicView } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { Graph, GraphSimulation, type GraphSimulationConfig } from '@cosmos.gl/graph'
import {
  CosmosGraphLayer,
  type CosmosGraphDataLoadedInfo,
  type CosmosGraphLinks,
  type CosmosGraphPickingInfo,
  type CosmosGraphPoints,
} from '@cosmos.gl/deck-layers'
import type { LayersList, PickingInfo } from '@deck.gl/core'
// The primitives are internal sublayers, not package exports
import { CosmosPointsLayer } from '../integrations/deck-layers/src/cosmos-points-layer'
import { CosmosLinksLayer } from '../integrations/deck-layers/src/cosmos-links-layer'

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

// A deck with no layers, plus the promise of its device for a cosmos instance
// to share
const createDeckDevice = (): {
  deck: Deck<OrthographicView>;
  container: HTMLDivElement;
  devicePromise: Promise<Device>;
} => {
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
  return { deck, container, devicePromise }
}

const createDeckWithSimulation = async (
  config: GraphSimulationConfig = {},
  positions: Float32Array = POSITIONS
): Promise<{
  deck: Deck<OrthographicView>;
  graph: GraphSimulation;
  container: HTMLDivElement;
}> => {
  const { deck, container, devicePromise } = createDeckDevice()
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

// For CosmosGraphLayer tests: the layer creates and owns its own simulation.
// Resolves once deck finished its async device initialization — picking
// before that asserts inside deck.
const createDeck = async (layers: LayersList): Promise<{ deck: Deck<OrthographicView>; container: HTMLDivElement }> => {
  const container = document.createElement('div')
  container.style.width = `${WIDTH}px`
  container.style.height = `${HEIGHT}px`
  document.body.appendChild(container)
  let deck!: Deck<OrthographicView>
  await new Promise<void>((resolve) => {
    deck = new Deck({
      parent: container,
      width: WIDTH,
      height: HEIGHT,
      views: new OrthographicView(),
      initialViewState: { target: [1000, 1000, 0], zoom: 0 },
      controller: false,
      onLoad: resolve,
      layers,
    })
  })
  return { deck, container }
}

// All forces off: the simulation runs but nothing moves
const STATIC_SIM: GraphSimulationConfig = {
  rescalePositions: false,
  simulationGravity: 0,
  simulationCenter: 0,
  simulationRepulsion: 0,
  simulationLinkSpring: 0,
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

  it('removes an existing point when its position becomes NaN — GraphSimulation snaps', async () => {
    const { deck, graph, container } = await createDeckWithSimulation({}, new Float32Array([1000, 1000, 1050, 1000]))
    try {
      deck.setProps({
        layers: [
          new CosmosPointsLayer({ id: 'points', graph, data: { length: 2 }, getPointSize: 10, pickable: true }),
        ],
      })
      await waitUntilPickable(deck)
      const at1 = worldToScreen(1050, 1000)
      expect(deck.pickObject({ ...at1, radius: 2 })?.index).toBe(1)

      graph.setPointPositions(new Float32Array([1000, 1000, NaN, NaN]), true)
      graph.applyData()

      // The texel is NaN now, not the frozen last coordinate: nothing draws or picks there
      expect(deck.pickObject({ ...at1, radius: 2 })).toBeNull()
      expect(deck.pickObject({ ...CENTER, radius: 2 })?.index).toBe(0)
    } finally {
      graph.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('removes an existing point when its position becomes NaN — a headless Graph snaps too', async () => {
    // A headless Graph on deck's device is the other documented source. Its
    // transitions are forced to snap (nothing would advance them), so the
    // default 800 ms transitionDuration must not leave a frozen coordinate
    const { deck, container, devicePromise } = createDeckDevice()
    const graph = new Graph(null, { rescalePositions: false }, devicePromise)
    graph.setPointPositions(new Float32Array([1000, 1000, 1050, 1000]))
    graph.render()
    await graph.ready
    try {
      deck.setProps({
        layers: [
          new CosmosPointsLayer({ id: 'points', graph, data: { length: 2 }, getPointSize: 10, pickable: true }),
        ],
      })
      await waitUntilPickable(deck)
      const at1 = worldToScreen(1050, 1000)
      expect(deck.pickObject({ ...at1, radius: 2 })?.index).toBe(1)

      graph.setPointPositions(new Float32Array([1000, 1000, NaN, NaN]))
      graph.render()

      expect(deck.pickObject({ ...at1, radius: 2 })).toBeNull()
      expect(deck.pickObject({ ...CENTER, radius: 2 })?.index).toBe(0)
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

describe('CosmosGraphLayer', () => {
  it('owns the simulation: creates, ingests, renders, picks, and destroys it', async () => {
    let simulation: GraphSimulation | undefined
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        links: new Float32Array([0, 1]),
        getPointSize: 10,
        getLinkWidth: 6,
        simulationConfig: STATIC_SIM,
        onSimulationCreated: (sim): void => { simulation = sim },
        pickable: true,
      }),
    ])
    try {
      await waitUntilPickable(deck)
      expect(simulation).toBeInstanceOf(GraphSimulation)

      const point = deck.pickObject({ ...CENTER, radius: 2 }) as CosmosGraphPickingInfo | null
      expect(point?.index).toBe(0)
      expect(point?.elementType).toBe('point')
      // Picking bubbles to the composite
      expect(point?.layer?.id).toBe('graph')

      const link = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as CosmosGraphPickingInfo | null
      expect(link?.index).toBe(0)
      expect(link?.elementType).toBe('link')

      // Removing the layer destroys the owned simulation; the handle stays safe
      deck.setProps({ layers: [] })
      await waitFrames(5)
      expect(deck.pickObject({ ...CENTER, radius: 2 })).toBeNull()
      expect(() => simulation?.step()).not.toThrow()
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('renders a provided simulation without configuring or destroying it', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const provided = new GraphSimulation(STATIC_SIM, devicePromise)
    const spaceSize = provided.config.spaceSize
    const created = vi.fn()
    const graphLayer = (simulation: GraphSimulation | null): CosmosGraphLayer => new CosmosGraphLayer({
      id: 'graph',
      simulation,
      points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
      links: new Float32Array([0, 1]),
      getPointSize: 10,
      // Both apply only to a layer-created simulation
      simulationConfig: { ...STATIC_SIM, spaceSize: spaceSize / 2 },
      onSimulationCreated: created,
      pickable: true,
    })
    try {
      deck.setProps({ layers: [graphLayer(provided)] })
      await waitUntilPickable(deck)

      // The layer ingested its data into the provided simulation and renders it
      expect(provided.data.linksNumber).toBe(1)
      expect(deck.pickObject({ ...CENTER, radius: 2 })?.index).toBe(0)
      expect(created).not.toHaveBeenCalled()
      expect(provided.config.spaceSize).toBe(spaceSize)

      // Dropping the prop swaps to a layer-created simulation; the provided
      // one outlives the swap and the layer's removal
      deck.setProps({ layers: [graphLayer(null)] })
      await waitUntilPickable(deck)
      expect(created).toHaveBeenCalledTimes(1)
      expect(created.mock.calls[0]?.[0]).not.toBe(provided)
      deck.setProps({ layers: [] })
      await waitFrames(5)
      expect(Array.from(provided.getPointPositionsArray())).toEqual([1000, 1000, 1050, 1000])
    } finally {
      provided.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('refuses a provided simulation on another device', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // No device argument: the simulation creates its own hidden one
    const foreign = new GraphSimulation(STATIC_SIM)
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        simulation: foreign,
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        getPointSize: 10,
        pickable: true,
      }),
    ])
    try {
      await foreign.ready
      await waitFrames(10)
      const deviceErrors = error.mock.calls.filter(([message]) => String(message).includes('different device'))
      expect(deviceErrors).toHaveLength(1)
      expect(deck.pickObject({ ...CENTER, radius: 2 })).toBeNull()
    } finally {
      error.mockRestore()
      foreign.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('resolves array data by point id and returns original objects from picking', async () => {
    const points = [
      { id: 'a', position: [1000, 1000] as const },
      { id: 'b', position: [1050, 1000] as const },
    ]
    const links = [{ source: 'a', target: 'b' }]
    const { deck, container } = await createDeck([
      new CosmosGraphLayer<(typeof points)[number], (typeof links)[number]>({
        id: 'graph',
        points,
        links,
        getPointId: (p): string => p.id,
        getPointPosition: (p): readonly [number, number] => p.position,
        getPointSize: 10,
        getLinkWidth: 6,
        simulationConfig: STATIC_SIM,
        pickable: true,
      }),
    ])
    try {
      await waitUntilPickable(deck)

      const point = deck.pickObject({ ...worldToScreen(1050, 1000), radius: 2 }) as CosmosGraphPickingInfo | null
      expect(point?.elementType).toBe('point')
      expect(point?.object).toEqual(points[1])

      const link = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as CosmosGraphPickingInfo | null
      expect(link?.elementType).toBe('link')
      expect(link?.object).toEqual(links[0])
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('reports each load with the index mapping, so per-link arrays sent from it line up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    type Point = { id: string; position: readonly [number, number] }
    type Link = { source: string; target: string; name: string }
    const points: Point[] = [
      { id: 'a', position: [1000, 1000] },
      { id: 'b', position: [1050, 1000] },
      { id: 'c', position: [1000, 1030] },
    ]
    // The middle link names no point: the simulation holds the other two, in their order
    const links: Link[] = [{ source: 'a', target: 'b', name: 'ab' }, { source: 'a', target: 'nope', name: 'dropped' }, { source: 'b', target: 'c', name: 'bc' }]
    const STRENGTH: Record<string, number> = { ab: 0.25, bc: 0.75, ca: 0.5 }
    let created: GraphSimulation | undefined
    const loads: CosmosGraphDataLoadedInfo<Link>[] = []
    // What the simulation holds when the callback runs, as point-index pairs
    const heldPairs: number[][] = []
    const graphLayer = (linkData: CosmosGraphLinks<Link>, pointColor: [number, number, number, number] = [0, 0, 255, 255]): CosmosGraphLayer<Point, Link> =>
      new CosmosGraphLayer<Point, Link>({
        id: 'graph',
        points,
        links: linkData,
        getPointId: (p): string => p.id,
        getPointPosition: (p): readonly [number, number] => p.position,
        getPointSize: 10,
        getPointColor: pointColor,
        simulationConfig: STATIC_SIM,
        onSimulationCreated: (sim): void => { created = sim },
        onSimulationDataLoaded: (info): void => {
          loads.push(info)
          heldPairs.push(Array.from(info.simulation.data.links ?? []))
          if (!info.links) return
          info.simulation.setLinkStrength(Float32Array.from(info.links, (l) => STRENGTH[l.name] as number))
          info.simulation.applyData()
        },
        pickable: true,
      })
    const { deck, container } = await createDeck([graphLayer(links)])
    try {
      await waitUntilPickable(deck)
      expect(loads).toHaveLength(1)
      const [first] = loads
      expect(first?.simulation).toBe(created)
      expect(first?.pointsLoaded).toBe(true)
      expect(first?.linksLoaded).toBe(true)
      expect(first?.pointIndexById?.get('c')).toBe(2)
      expect(first?.links?.map((l) => l.name)).toEqual(['ab', 'bc'])
      // The reported links are the ones the simulation holds, in its order
      const toPairs = (info: CosmosGraphDataLoadedInfo<Link> | undefined): number[] =>
        (info?.links ?? []).flatMap((l) => [info?.pointIndexById?.get(l.source) as number, info?.pointIndexById?.get(l.target) as number])
      expect(heldPairs[0]).toEqual(toPairs(first))
      // ...so the strengths sent from it are the ones the simulation applies
      expect(Array.from(created!.data.linkStrength ?? [])).toEqual([0.25, 0.75])

      // A restyle loads nothing, so there is nothing to report
      deck.setProps({ layers: [graphLayer(links, [255, 0, 0, 255])] })
      await waitFrames(5)
      expect(loads).toHaveLength(1)

      // New links, same points: reported as a links load, and what it sends lines up again
      const reordered: Link[] = [{ source: 'b', target: 'c', name: 'bc' }, { source: 'c', target: 'a', name: 'ca' }, { source: 'a', target: 'b', name: 'ab' }]
      deck.setProps({ layers: [graphLayer(reordered)] })
      await waitFrames(5)
      expect(loads).toHaveLength(2)
      expect(loads[1]?.pointsLoaded).toBe(false)
      expect(loads[1]?.linksLoaded).toBe(true)
      expect(loads[1]?.links?.map((l) => l.name)).toEqual(['bc', 'ca', 'ab'])
      expect(heldPairs[1]).toEqual(toPairs(loads[1]))
      expect(Array.from(created!.data.linkStrength ?? [])).toEqual([0.75, 0.5, 0.25])

      // Binary links are in the caller's own order: no links to report
      deck.setProps({ layers: [graphLayer(new Float32Array([0, 1]))] })
      await waitFrames(5)
      expect(loads).toHaveLength(3)
      expect(loads[2]?.linksLoaded).toBe(true)
      expect(loads[2]?.links).toBeNull()
    } finally {
      warn.mockRestore()
      deck.finalize()
      container.remove()
    }
  })

  it('reports a provided simulation and an id-only remap, and survives a callback that throws', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const provided = new GraphSimulation(STATIC_SIM, devicePromise)
    type Point = { id: string; alias: string }
    const points: Point[] = [{ id: 'a', alias: 'x' }, { id: 'b', alias: 'y' }]
    // One pair array throughout: a new one would be a links load
    const pairs = new Float32Array([0, 1])
    const loads: CosmosGraphDataLoadedInfo[] = []
    const errors: Error[] = []
    const created = vi.fn()
    const graphLayer = (getPointId: (p: Point) => string, trigger: number): CosmosGraphLayer<Point> => new CosmosGraphLayer<Point>({
      id: 'graph',
      simulation: provided,
      points,
      links: pairs,
      getPointId,
      getPointPosition: (_, { index }): [number, number] => [1000 + index * 50, 1000],
      getPointSize: 10,
      updateTriggers: { getPointId: trigger },
      onSimulationCreated: created,
      onSimulationDataLoaded: (info): void => {
        loads.push(info)
        // An app bug on the first load must not keep the layer from becoming ready
        if (loads.length === 1) throw new Error('app bug')
      },
      onError: (error): boolean => { errors.push(error); return true },
      pickable: true,
    })
    try {
      // Picking asserts until deck's device is up
      await provided.ready
      deck.setProps({ layers: [graphLayer((p) => p.id, 0)] })
      await waitUntilPickable(deck)
      expect(loads).toHaveLength(1)
      expect(loads[0]?.simulation).toBe(provided)
      expect(created).not.toHaveBeenCalled()
      expect(errors[0]?.message).toContain('onSimulationDataLoaded')
      expect(errors[0]?.message).toContain('app bug')

      // New ids over the same positions and pairs: nothing reloads, but ids reach indices anew
      deck.setProps({ layers: [graphLayer((p) => p.alias, 1)] })
      await waitFrames(5)
      expect(loads).toHaveLength(2)
      expect(loads[1]?.pointsLoaded).toBe(false)
      expect(loads[1]?.linksLoaded).toBe(false)
      expect(loads[1]?.pointIndexById?.get('y')).toBe(1)
      expect(loads[1]?.links).toBeNull()
    } finally {
      provided.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('drops a link whose endpoint is not a point — from the simulation and the rendering alike', async () => {
    const points = [
      { id: 'a', position: [1000, 1000] as const },
      { id: 'b', position: [1050, 1000] as const },
      { id: 'c', position: [1000, 1030] as const },
    ]
    // The second link names a point that does not exist; resolved to index 0
    // as a fallback it would draw from c to a
    const links = [{ source: 'a', target: 'b' }, { source: 'c', target: 'ghost' }]
    let simulation: GraphSimulation | undefined
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { deck, container } = await createDeck([
      new CosmosGraphLayer<(typeof points)[number], (typeof links)[number]>({
        id: 'graph',
        points,
        links,
        getPointId: (p): string => p.id,
        getPointPosition: (p): readonly [number, number] => p.position,
        getPointSize: 10,
        getLinkWidth: 6,
        simulationConfig: STATIC_SIM,
        onSimulationCreated: (sim): void => { simulation = sim },
        pickable: true,
      }),
    ])
    try {
      await waitUntilPickable(deck)

      const dropWarnings = warn.mock.calls.filter(([message]) => String(message).includes('dropped 1 of 2 links'))
      expect(dropWarnings).toHaveLength(1)
      // The simulation holds only the resolvable link
      expect(simulation?.data.linksNumber).toBe(1)

      // The surviving link still picks with its original object …
      const link = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as CosmosGraphPickingInfo | null
      expect(link?.elementType).toBe('link')
      expect(link?.object).toEqual(links[0])
      // … and nothing is drawn where the dropped link would have landed
      expect(deck.pickObject({ ...worldToScreen(1000, 1015), radius: 2 })).toBeNull()
    } finally {
      warn.mockRestore()
      deck.finalize()
      container.remove()
    }
  })

  it('re-resolves link endpoints when getPointId changes over stable arrays', async () => {
    // Under `id` the link runs a → b (horizontal); under `alt` the same link
    // object resolves 'b' to the third point, so it runs a → c (vertical)
    const points = [
      { id: 'a', alt: 'a', position: [1000, 1000] as const },
      { id: 'b', alt: 'c', position: [1050, 1000] as const },
      { id: 'c', alt: 'b', position: [1000, 1030] as const },
    ]
    const links = [{ source: 'a', target: 'b' }]
    type P = (typeof points)[number]
    type L = (typeof links)[number]
    const makeLayer = (getPointId: (p: P) => string, trigger: number): CosmosGraphLayer<P, L> =>
      new CosmosGraphLayer<P, L>({
        id: 'graph',
        points,
        links,
        getPointId,
        getPointPosition: (p): readonly [number, number] => p.position,
        getPointSize: 10,
        getLinkWidth: 6,
        simulationConfig: STATIC_SIM,
        updateTriggers: { getPointId: trigger },
        pickable: true,
      })
    const horizontal = worldToScreen(1025, 1000)
    const vertical = worldToScreen(1000, 1015)
    const { deck, container } = await createDeck([makeLayer((p) => p.id, 1)])
    try {
      await waitUntilPickable(deck)
      expect((deck.pickObject({ ...horizontal, radius: 2 }) as CosmosGraphPickingInfo | null)?.elementType).toBe('link')
      expect(deck.pickObject({ ...vertical, radius: 2 })).toBeNull()

      // Same arrays, new id accessor and trigger: the link must move with the id map
      deck.setProps({ layers: [makeLayer((p) => p.alt, 2)] })
      await waitFrames(5)
      expect((deck.pickObject({ ...vertical, radius: 2 }) as CosmosGraphPickingInfo | null)?.elementType).toBe('link')
      expect(deck.pickObject({ ...horizontal, radius: 2 })).toBeNull()
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('steps itself from deck timeline — no app render-loop wiring anywhere', async () => {
    let simulation: GraphSimulation | undefined
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        links: new Float32Array([0, 1]),
        getPointSize: 10,
        simulationConfig: {
          rescalePositions: false,
          simulationGravity: 0,
          simulationCenter: 0,
          simulationRepulsion: 0,
          simulationLinkSpring: 2,
          simulationLinkDistance: 10,
          simulationFriction: 0.85,
          simulationDecay: 1000,
          randomSeed: 1,
        },
        onSimulationCreated: (sim): void => { simulation = sim },
        pickable: true,
      }),
    ])
    try {
      // Nothing here calls step(): the layer's timeline animation must move
      // the linked points on its own
      let x0 = 1000
      for (let i = 0; i < 240 && Math.abs(x0 - 1000) < 8; i += 1) {
        await waitFrames(1)
        const positions = simulation?.getPointPositionsArray()
        if (positions && positions.length >= 2) x0 = positions[0] as number
      }
      expect(Math.abs(x0 - 1000)).toBeGreaterThanOrEqual(8)

      // And picking tracks the moved point
      const positions = simulation!.getPointPositionsArray()
      const screen = worldToScreen(positions[0] as number, positions[1] as number)
      const moved = deck.pickObject({ x: Math.round(screen.x), y: Math.round(screen.y), radius: 3 })
      expect(moved?.index).toBe(0)
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('leaves deck the blending and depth testing its own layers draw with', async () => {
    const ticks = { count: 0 }
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        links: new Float32Array([0, 1]),
        getPointSize: 10,
        simulationConfig: { ...STATIC_SIM, onSimulationTick: (): void => { ticks.count += 1 } },
        pickable: true,
      }),
    ])
    try {
      await waitUntilPickable(deck)
      for (let i = 0; i < 240 && ticks.count < 5; i += 1) await waitFrames(1)
      expect(ticks.count).toBeGreaterThanOrEqual(5)
      // deck enables both once, when it creates the device, and a text or path layer
      // declares neither: with them off, glyph edges overwrite the canvas alpha
      const gl = (deck as unknown as { device: Device & { gl: WebGL2RenderingContext } }).device.gl
      expect(gl.isEnabled(gl.BLEND)).toBe(true)
      expect(gl.isEnabled(gl.DEPTH_TEST)).toBe(true)
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('drags a point: pins on start, moves with the pointer, releases on end', async () => {
    let simulation: GraphSimulation | undefined
    const calls = { start: 0, drag: 0, end: 0 }
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        getPointSize: 10,
        simulationConfig: STATIC_SIM,
        onSimulationCreated: (sim): void => { simulation = sim },
        pickable: true,
        enablePointDrag: true,
        dragReheatAlpha: null,
        onPointDragStart: (): void => { calls.start += 1 },
        onPointDrag: (): void => { calls.drag += 1 },
        onPointDragEnd: (): void => { calls.end += 1 },
      }),
    ])
    try {
      await waitUntilPickable(deck)
      const info = deck.pickObject({ ...CENTER, radius: 2 }) as CosmosGraphPickingInfo
      const layer = info.layer as unknown as CosmosGraphLayer
      let stopped = 0
      const event = { stopImmediatePropagation: (): void => { stopped += 1 } }

      expect(layer.onDragStart(info, event)).toBe(true)
      expect(simulation?.isPointPinned(0)).toBe(true)
      expect(stopped).toBe(1)
      expect(calls.start).toBe(1)

      // Deck freezes info.index for the gesture and refreshes coordinate
      expect(layer.onDrag({ ...info, coordinate: [1010, 985] }, event)).toBe(true)
      const positions = simulation!.getPointPositionsArray()
      expect(positions[0]).toBeCloseTo(1010, 0)
      expect(positions[1]).toBeCloseTo(985, 0)
      // Picking tracks the dragged point at its new position
      const moved = deck.pickObject({ ...worldToScreen(1010, 985), radius: 2 })
      expect(moved?.index).toBe(0)
      expect(calls.drag).toBe(1)

      expect(layer.onDragEnd(info, event)).toBe(true)
      expect(simulation?.isPointPinned(0)).toBe(false)
      expect(calls.end).toBe(1)
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('ignores drags off points, and keeps the pin when unpinOnDragEnd is false', async () => {
    let simulation: GraphSimulation | undefined
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        links: new Float32Array([0, 1]),
        getPointSize: 10,
        getLinkWidth: 6,
        simulationConfig: STATIC_SIM,
        onSimulationCreated: (sim): void => { simulation = sim },
        pickable: true,
        enablePointDrag: true,
        dragReheatAlpha: null,
        unpinOnDragEnd: false,
      }),
    ])
    try {
      await waitUntilPickable(deck)
      let stopped = 0
      const event = { stopImmediatePropagation: (): void => { stopped += 1 } }

      // A link is not draggable: the gesture falls through to the controller
      const linkInfo = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as CosmosGraphPickingInfo
      expect(linkInfo.elementType).toBe('link')
      const layer = linkInfo.layer as unknown as CosmosGraphLayer
      expect(layer.onDragStart(linkInfo, event)).toBe(false)
      expect(stopped).toBe(0)
      expect(simulation?.isPointPinned(0)).toBe(false)

      // unpinOnDragEnd: false keeps the point where it was dropped
      const pointInfo = deck.pickObject({ ...CENTER, radius: 2 }) as CosmosGraphPickingInfo
      layer.onDragStart(pointInfo, event)
      layer.onDrag({ ...pointInfo, coordinate: [995, 1010] }, event)
      layer.onDragEnd(pointInfo, event)
      expect(simulation?.isPointPinned(0)).toBe(true)
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('highlights only the hovered sublayer — point N must not tint link N', async () => {
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        links: new Float32Array([0, 1]),
        getPointSize: 10,
        getLinkWidth: 6,
        simulationConfig: STATIC_SIM,
        pickable: true,
        autoHighlight: true,
      }),
    ])
    const pointsProto = CosmosPointsLayer.prototype.updateAutoHighlight
    const linksProto = CosmosLinksLayer.prototype.updateAutoHighlight
    try {
      await waitUntilPickable(deck)
      const calls: { id: string; picked: boolean }[] = []
      const spy = function (this: { id: string }, info: PickingInfo): void {
        calls.push({ id: this.id, picked: Boolean(info.picked) })
      }
      CosmosPointsLayer.prototype.updateAutoHighlight = spy
      CosmosLinksLayer.prototype.updateAutoHighlight = spy

      // Hovering a point highlights the points sublayer and clears the links one
      const pointInfo = deck.pickObject({ ...CENTER, radius: 2 }) as CosmosGraphPickingInfo
      const composite = pointInfo.layer as unknown as { _updateAutoHighlight (info: PickingInfo): void }
      composite._updateAutoHighlight({ ...pointInfo, picked: true })
      expect(calls).toContainEqual({ id: 'graph-points', picked: true })
      expect(calls).toContainEqual({ id: 'graph-links', picked: false })

      // And the other way around for a link
      calls.length = 0
      const linkInfo = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as CosmosGraphPickingInfo
      composite._updateAutoHighlight({ ...linkInfo, picked: true })
      expect(calls).toContainEqual({ id: 'graph-links', picked: true })
      expect(calls).toContainEqual({ id: 'graph-points', picked: false })
    } finally {
      CosmosPointsLayer.prototype.updateAutoHighlight = pointsProto
      CosmosLinksLayer.prototype.updateAutoHighlight = linksProto
      deck.finalize()
      container.remove()
    }
  })
})

// An application-loaded simulation: with no `points` of its own, the layer
// writes nothing into the simulation, draws what it holds and follows its
// changes. A layer with `points` loads them, but only once the device check
// has passed. Layers sharing a simulation step it once per frame.
describe('CosmosGraphLayer with an application-loaded simulation', () => {
  const INITIAL = [1000, 1000, 1050, 1000]
  const SECOND_POINT = worldToScreen(1050, 1000)

  // The application's simulation on deck's device, holding two points and one link
  const loadedSimulation = (devicePromise: Promise<Device>, config: GraphSimulationConfig = STATIC_SIM): GraphSimulation => {
    const simulation = new GraphSimulation(config, devicePromise)
    simulation.setPointPositions(new Float32Array(INITIAL), true)
    simulation.setLinks(new Float32Array([0, 1]))
    simulation.applyData()
    return simulation
  }

  // A layer without data of its own: it draws the simulation
  const viewLayer = (simulation: GraphSimulation, id = 'graph'): CosmosGraphLayer =>
    new CosmosGraphLayer({ id, simulation, getPointSize: 10, pickable: true })

  // Bounded wait for a pick at a screen position that satisfies `accept`
  const waitUntilPicked = async (
    deck: Deck<OrthographicView>,
    screen: { x: number; y: number },
    accept: (info: PickingInfo | null) => boolean = (info): boolean => info !== null,
    maxFrames = 240
  ): Promise<void> => {
    for (let i = 0; i < maxFrames; i += 1) {
      await waitFrames(1)
      if (accept(deck.pickObject({ ...screen, radius: 2 }))) return
    }
    throw new Error(`no accepted pick at (${screen.x}, ${screen.y}) within ${maxFrames} frames`)
  }
  // The second point stays at (1050, 1000) in every scenario below
  const waitUntilRendered = (deck: Deck<OrthographicView>): Promise<void> => waitUntilPicked(deck, SECOND_POINT)

  it('draws the simulation as loaded and keeps its layout across hide and show', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const provided = loadedSimulation(devicePromise)
    try {
      deck.setProps({ layers: [viewLayer(provided)] })
      await provided.ready
      await waitUntilRendered(deck)

      // Nothing was written: still the application's two points and one link, both drawn
      expect(provided.data.pointsNumber).toBe(2)
      expect(provided.data.linksNumber).toBe(1)
      const link = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as CosmosGraphPickingInfo | null
      expect(link?.elementType).toBe('link')

      // The application moves a point in its simulation: a saved layout, an algorithm, a drag
      provided.setPointPosition(0, 1000, 1030)
      await waitFrames(2)
      expect(Array.from(provided.getPointPositionsArray())).toEqual([1000, 1030, 1050, 1000])

      // Hide the graph, then show it again: the layout is the simulation's, and it stays
      deck.setProps({ layers: [] })
      await waitFrames(5)
      deck.setProps({ layers: [viewLayer(provided)] })
      await waitUntilRendered(deck)
      expect(Array.from(provided.getPointPositionsArray())).toEqual([1000, 1030, 1050, 1000])
      expect(deck.pickObject({ ...worldToScreen(1000, 1030), radius: 2 })?.index).toBe(0)
    } finally {
      provided.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('leaves the data of a simulation it refuses untouched', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // The application's simulation on its own device, already holding the application's data
    const foreign = new GraphSimulation(STATIC_SIM)
    foreign.setPointPositions(new Float32Array([1, 1, 2, 2, 3, 3]), true)
    foreign.applyData()
    await foreign.ready
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        simulation: foreign,
        points: { length: 2, initialPositions: new Float32Array(INITIAL) },
        links: new Float32Array([0, 1]),
        getPointSize: 10,
        pickable: true,
      }),
    ])
    try {
      await waitFrames(10)
      expect(error.mock.calls.filter(([message]) => String(message).includes('different device'))).toHaveLength(1)
      // Refused to render, so nothing of the application's changed
      expect(foreign.data.pointsNumber).toBe(3)
      expect(foreign.data.linksNumber ?? 0).toBe(0)
      expect(Array.from(foreign.getPointPositionsArray())).toEqual([1, 1, 2, 2, 3, 3])
    } finally {
      error.mockRestore()
      foreign.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('shows a settled simulation as it is', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    // Cools to the alpha floor within a few steps
    const provided = loadedSimulation(devicePromise, { ...STATIC_SIM, simulationDecay: 10 })
    try {
      deck.setProps({ layers: [viewLayer(provided)] })
      await provided.ready
      await waitUntilRendered(deck)
      for (let i = 0; i < 240 && provided.isSimulationRunning; i += 1) await waitFrames(1)
      expect(provided.isSimulationRunning).toBe(false)
      const settled = Array.from(provided.getPointPositionsArray())

      // Hidden and shown again, a settled simulation is still settled, on the same layout
      deck.setProps({ layers: [] })
      await waitFrames(5)
      deck.setProps({ layers: [viewLayer(provided)] })
      await waitUntilRendered(deck)
      expect({
        positions: Array.from(provided.getPointPositionsArray()),
        running: provided.isSimulationRunning,
      }).toEqual({ positions: settled, running: false })
    } finally {
      provided.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('follows data the application loads after the layer attached', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const provided = new GraphSimulation(STATIC_SIM, devicePromise)
    try {
      // An empty simulation: the layer draws nothing and waits
      deck.setProps({ layers: [viewLayer(provided)] })
      await provided.ready
      await waitFrames(10)
      expect(deck.pickObject({ ...CENTER, radius: 2 })).toBeNull()

      // The application loads it: the layer picks the data up
      provided.setPointPositions(new Float32Array(INITIAL), true)
      provided.setLinks(new Float32Array([0, 1]))
      provided.applyData()
      await waitUntilRendered(deck)
      expect(deck.pickObject({ ...CENTER, radius: 2 })?.index).toBe(0)
      expect((deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as CosmosGraphPickingInfo | null)?.elementType).toBe('link')

      // And follows a replacement: a third point appears
      provided.setPointPositions(new Float32Array([...INITIAL, 1000, 1030]), true)
      provided.applyData()
      await waitUntilPicked(deck, worldToScreen(1000, 1030), (info) => info?.index === 2)
    } finally {
      provided.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('steps a simulation shared by two layers once per frame', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    let ticks = 0
    const provided = loadedSimulation(devicePromise, { ...STATIC_SIM, onSimulationTick: (): void => { ticks += 1 } })
    const stepsOver = async (frames: number): Promise<number> => {
      ticks = 0
      await waitFrames(frames)
      return ticks
    }
    try {
      // One layer: the main view
      deck.setProps({ layers: [viewLayer(provided, 'main')] })
      await provided.ready
      await waitUntilRendered(deck)
      const alone = await stepsOver(30)
      expect(alone).toBeGreaterThan(0)

      // A second layer on the same simulation: a minimap styled differently
      deck.setProps({ layers: [viewLayer(provided, 'main'), viewLayer(provided, 'minimap')] })
      await waitFrames(10)
      const shared = await stepsOver(30)
      // The layout runs at the same speed: one step per frame, not one per layer
      expect(shared).toBeLessThan(alone * 1.5)
    } finally {
      provided.destroy()
      deck.finalize()
      container.remove()
    }
  })
})

// Binary links carry styling channels beside the pair array, and a restyle —
// a new `points` or `links` object over the same positions or pairs — never
// reloads the simulation, so the layout stays.
describe('CosmosGraphLayer binary links and restyling', () => {
  const INITIAL = [1000, 1000, 1050, 1000]
  type LinkChannels = { getLinkColor?: { value: unknown }; getLinkWidth?: { value: unknown }; getLinkSource?: { value: unknown } }
  // The links sublayer's data, reached through a pick on the link it draws
  const linksSublayerData = (deck: Deck<OrthographicView>, at: { x: number; y: number }): { attributes: LinkChannels } => {
    const info = deck.pickObject({ ...at, radius: 2 })
    expect(info?.sourceLayer?.id).toBe('graph-links')
    return info!.sourceLayer!.props.data as { attributes: LinkChannels }
  }

  it('styles binary links from attributes and restyles without reloading the simulation', async () => {
    let simulation: GraphSimulation | undefined
    const pairs = new Float32Array([0, 1])
    const colors = new Uint8Array([255, 0, 0, 255])
    const widths = new Float32Array([6])
    const points = { length: 2, initialPositions: new Float32Array(INITIAL) }
    const graphLayer = (links: CosmosGraphLinks<unknown>, pointsInput: CosmosGraphPoints<unknown> = points): CosmosGraphLayer => new CosmosGraphLayer({
      id: 'graph',
      points: pointsInput,
      links,
      getPointSize: 10,
      simulationConfig: STATIC_SIM,
      onSimulationCreated: (sim): void => { simulation = sim },
      pickable: true,
    })
    const { deck, container } = await createDeck([
      graphLayer({ pairs, attributes: { getLinkColor: { value: colors, size: 4 }, getLinkWidth: { value: widths, size: 1 } } }),
    ])
    try {
      await waitUntilPickable(deck)
      // The channels reach the links sublayer as they are, beside the endpoints
      const { attributes } = linksSublayerData(deck, worldToScreen(1025, 1000))
      expect(attributes.getLinkColor?.value).toBe(colors)
      expect(attributes.getLinkWidth?.value).toBe(widths)
      expect(attributes.getLinkSource?.value).toBe(pairs)

      // The application moves a point; restyling the links must not undo it
      simulation!.setPointPosition(0, 1000, 1030)
      await waitFrames(2)
      const recolored = new Uint8Array([0, 255, 0, 255])
      deck.setProps({ layers: [graphLayer({ pairs, attributes: { getLinkColor: { value: recolored, size: 4 } } })] })
      await waitFrames(5)
      // The link now runs from (1000, 1030) to (1050, 1000)
      expect(linksSublayerData(deck, worldToScreen(1025, 1015)).attributes.getLinkColor?.value).toBe(recolored)
      expect(Array.from(simulation!.getPointPositionsArray())).toEqual([1000, 1030, 1050, 1000])

      // Restyling binary points over the same `initialPositions` keeps the layout too
      const pointColors = new Uint8Array(8).fill(255)
      deck.setProps({ layers: [graphLayer({ pairs }, { ...points, attributes: { getPointColor: { value: pointColors, size: 4 } } })] })
      await waitFrames(5)
      expect(Array.from(simulation!.getPointPositionsArray())).toEqual([1000, 1030, 1050, 1000])

      // New pairs load new links, still without touching the positions
      const reversed = new Float32Array([1, 0])
      deck.setProps({ layers: [graphLayer(reversed)] })
      await waitFrames(5)
      expect(simulation!.data.links).toBe(reversed)
      expect(Array.from(simulation!.getPointPositionsArray())).toEqual([1000, 1030, 1050, 1000])
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('skips a pair that names no point and keeps link indices', async () => {
    let simulation: GraphSimulation | undefined
    // Three points; link 0 names point 7, link 1 a fraction, link 2 NaN — link 3 is fine
    const pairs = new Float32Array([0, 7, 0, 2.5, NaN, 1, 0, 1])
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 3, initialPositions: new Float32Array([...INITIAL, 1000, 1030]) },
        links: pairs,
        getPointSize: 10,
        simulationConfig: STATIC_SIM,
        onSimulationCreated: (sim): void => { simulation = sim },
        pickable: true,
      }),
    ])
    try {
      await waitUntilPickable(deck)
      // Nothing dropped: the pair array is the simulation's, index for index
      expect(simulation!.data.links).toBe(pairs)
      expect(simulation!.data.linksNumber).toBe(4)
      // The good link is drawn at its own index
      const link = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as CosmosGraphPickingInfo | null
      expect(link?.elementType).toBe('link')
      expect(link?.index).toBe(3)
      // Point 7's texel is unwritten, so a drawn link 0 would run from point 0 towards the origin
      expect(deck.pickObject({ ...worldToScreen(980, 980), radius: 2 })).toBeNull()
      // 2.5 truncated would be point 2, so a drawn link 1 would run from point 0 to it
      expect(deck.pickObject({ ...worldToScreen(1000, 1015), radius: 2 })).toBeNull()
    } finally {
      deck.finalize()
      container.remove()
    }
  })
})
