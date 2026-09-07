import { describe, it, expect, vi } from 'vitest'
import { Deck, OrthographicView } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { Graph, GraphSimulation, type GraphSimulationConfig } from '@cosmos.gl/graph'
import { CosmosPointsLayer, CosmosLinksLayer, CosmosGraphLayer, type CosmosGraphPickingInfo } from '@cosmos.gl/deck-layers'
import type { LayersList, PickingInfo } from '@deck.gl/core'

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
