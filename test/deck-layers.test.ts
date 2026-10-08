import { describe, it, expect, vi } from 'vitest'
import { Deck, MapView, OrthographicView } from '@deck.gl/core'
import type { Device } from '@luma.gl/core'
import { Graph, defaultConfigValues } from '@cosmos.gl/graph'
import {
  CosmosGraphLayer,
  type CosmosGraphDataLoadedInfo,
  type CosmosGraphLayerConfig,
  type CosmosGraphLinks,
  type CosmosGraphPickingInfo,
} from '@cosmos.gl/deck-layers'
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core'

/**
 * Runtime contract tests for @cosmos.gl/deck-layers: the layer runs a headless
 * cosmos.gl `Graph` on deck.gl's device, loads deck-style data into it, hands it
 * deck's view before each draw and lets cosmos.gl draw into deck's render pass.
 * Covered: data loading and accessors, the view handed to cosmos, config,
 * simulation stepping, deck picking through cosmos's picking mode
 * (`deck.pickObject`), auto-highlight through the graph's host hover, and drag-to-pin.
 */

const WIDTH = 200
const HEIGHT = 200
// Points at known space coordinates; the view targets (1000, 1000) at zoom 0,
// so world units map 1:1 to pixels around the canvas centre — with flipY off,
// as cosmos's space has y up
const POSITIONS = new Float32Array([1000, 1000, 1050, 1000, 1000, 1030])
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 }

/** Where the test view puts a space position: y up, as cosmos's space has it. */
const worldToScreen = (x: number, y: number): { x: number; y: number } =>
  ({ x: CENTER.x + (x - 1000), y: CENTER.y - (y - 1000) })

// A deck with no layers, plus the promise of its device for a graph to share
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
      views: new OrthographicView({ flipY: false }),
      initialViewState: { target: [1000, 1000, 0], zoom: 0 },
      controller: false,
      onDeviceInitialized: resolve,
      layers: [],
    })
  })
  return { deck, container, devicePromise }
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

// Deck initializes and updates layers on its own animation frames: wait for a
// condition instead of guessing a frame count, but stay bounded
const waitUntil = async (condition: () => boolean, what: string, maxFrames = 240): Promise<void> => {
  for (let i = 0; i < maxFrames; i += 1) {
    if (condition()) return
    await waitFrames(1)
  }
  throw new Error(`${what} did not happen within ${maxFrames} frames`)
}

// For CosmosGraphLayer tests: the layer creates and owns its own graph.
// Resolves once deck finished its async device initialization.
const createDeck = async (
  layers: LayersList,
  views: OrthographicView | MapView = new OrthographicView({ flipY: false }),
  initialViewState: Record<string, unknown> = { target: [1000, 1000, 0], zoom: 0 }
): Promise<{ deck: Deck<OrthographicView | MapView>; container: HTMLDivElement }> => {
  const container = document.createElement('div')
  container.style.width = `${WIDTH}px`
  container.style.height = `${HEIGHT}px`
  document.body.appendChild(container)
  let deck!: Deck<OrthographicView | MapView>
  await new Promise<void>((resolve) => {
    deck = new Deck({
      parent: container,
      width: WIDTH,
      height: HEIGHT,
      views,
      initialViewState,
      controller: false,
      onLoad: resolve,
      layers,
    })
  })
  return { deck, container }
}

// All forces off: the simulation runs but nothing moves
const STATIC: CosmosGraphLayerConfig = {
  rescalePositions: false,
  simulationGravity: 0,
  simulationCenter: 0,
  simulationRepulsion: 0,
  simulationLinkSpring: 0,
}

/** cosmos's 0..1 channels as 0..255 bytes, for exact comparisons. */
const bytes = (channels: Float32Array): number[] => Array.from(channels, (c) => Math.round(c * 255))

/** The pixel deck puts a world position at, through the deck's first viewport. */
const deckPixel = (deck: Deck<OrthographicView | MapView>, world: number[]): [number, number] => {
  const pixel = deck.getViewports()[0]!.project(world)
  return [pixel[0] as number, pixel[1] as number]
}

describe('CosmosGraphLayer', () => {
  it('owns a headless graph on deck\'s device: creates, loads, draws under deck\'s view, destroys it', async () => {
    let graph: Graph | undefined
    let loaded = false
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 3, initialPositions: POSITIONS },
        links: new Float32Array([0, 1]),
        config: STATIC,
        onGraphCreated: (created): void => { graph = created },
        onGraphDataLoaded: (): void => { loaded = true },
      }),
    ])
    try {
      await waitUntil(() => loaded, 'the first load')
      expect(graph).toBeInstanceOf(Graph)
      expect(graph!.graph.pointsNumber).toBe(3)
      expect(graph!.graph.linksNumber).toBe(1)
      // deck's device, nothing of cosmos's own
      expect(graph!.simulation.device).toBe((deck as unknown as { device: Device }).device)

      // The draw handed cosmos deck's view: cosmos projects where deck projects
      await waitFrames(5)
      for (const [x, y] of [[1000, 1000], [1050, 1000], [1000, 1030]]) {
        const [sx, sy] = graph!.spaceToScreenPosition([x as number, y as number])
        const [dx, dy] = deckPixel(deck, [x as number, y as number, 0])
        expect(sx).toBeCloseTo(dx, 3)
        expect(sy).toBeCloseTo(dy, 3)
      }
      const [cx, cy] = graph!.spaceToScreenPosition([1000, 1000])
      expect(cx).toBeCloseTo(CENTER.x, 3)
      expect(cy).toBeCloseTo(CENTER.y, 3)

      // Removing the layer destroys the graph it created; the handle stays safe
      const destroy = vi.spyOn(graph!, 'destroy')
      deck.setProps({ layers: [] })
      await waitFrames(5)
      expect(destroy).toHaveBeenCalledTimes(1)
      expect(() => graph!.step()).not.toThrow()
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('draws under a map view through modelMatrix: cosmos\'s view matches deck\'s projection', async () => {
    const SPACE = 4096
    const toLayout = ([lng, lat]: [number, number]): [number, number] => [
      ((lng + 180) / 360) * SPACE,
      ((Math.PI + Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / (2 * Math.PI)) * SPACE,
    ]
    const cities: [number, number][] = [[-0.13, 51.51], [139.69, 35.69], [-46.63, -23.55]]
    let graph: Graph | undefined
    let loaded = false
    const { deck, container } = await createDeck([
      new CosmosGraphLayer<[number, number]>({
        id: 'graph',
        points: cities,
        getPointPosition: (lngLat): [number, number] => toLayout(lngLat),
        modelMatrix: [512 / SPACE, 0, 0, 0, 0, 512 / SPACE, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        config: { ...STATIC, spaceSize: SPACE },
        onGraphCreated: (created): void => { graph = created },
        onGraphDataLoaded: (): void => { loaded = true },
      }),
    ], new MapView({ repeat: false }), { longitude: 20, latitude: 22, zoom: 1.4 })
    try {
      await waitUntil(() => loaded, 'the first load')
      await waitFrames(5)
      // A city drawn by cosmos lands where deck puts its longitude and latitude
      for (const lngLat of cities) {
        const [sx, sy] = graph!.spaceToScreenPosition(toLayout(lngLat))
        const [dx, dy] = deckPixel(deck, [...lngLat, 0])
        expect(sx).toBeCloseTo(dx, 2)
        expect(sy).toBeCloseTo(dy, 2)
      }
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('does not draw a y-down view, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const isViewWarning = (message: unknown): boolean => String(message).includes('flipY')
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 3, initialPositions: POSITIONS },
        config: STATIC,
      }),
    ], new OrthographicView()) // flipY on: y down, which cosmos's view cannot express
    try {
      await waitUntil(() => warn.mock.calls.some(([message]) => isViewWarning(message)), 'the view warning')
      await waitFrames(10)
      expect(warn.mock.calls.filter(([message]) => isViewWarning(message))).toHaveLength(1)
    } finally {
      warn.mockRestore()
      deck.finalize()
      container.remove()
    }
  })

  it('converts deck accessors into cosmos\'s channels, and restyles without reloading the layout', async () => {
    type Point = { id: string; group: number }
    const points: Point[] = [{ id: 'a', group: 0 }, { id: 'b', group: 1 }]
    const links = [{ source: 'a', target: 'b' }]
    let graph: Graph | undefined
    const graphLayer = (scheme: number): CosmosGraphLayer<Point> => new CosmosGraphLayer<Point>({
      id: 'graph',
      points,
      links,
      getPointId: (p): string => p.id,
      getPointPosition: (p): [number, number] => (p.id === 'a' ? [1000, 1000] : [1050, 1000]),
      getPointColor: (): [number, number, number, number] => (scheme === 0 ? [255, 0, 0, 255] : [0, 255, 0, 128]),
      getPointSize: (p): number => (p.group === 0 ? 10 : 20),
      getLinkColor: [0, 0, 255, 51],
      getLinkWidth: 3,
      updateTriggers: { getPointColor: scheme },
      config: STATIC,
      onGraphCreated: (created): void => { graph = created },
    })
    const { deck, container } = await createDeck([graphLayer(0)])
    try {
      await waitUntil(() => (graph?.graph.pointColors?.length ?? 0) > 0, 'the first load')
      // deck's 0..255 as cosmos's 0..1
      expect(Array.from(graph!.graph.pointColors!)).toEqual([1, 0, 0, 1, 1, 0, 0, 1])
      expect(Array.from(graph!.graph.pointSizes!)).toEqual([10, 20])
      expect(Array.from(graph!.graph.linkColors!).map((c) => Math.round(c * 255))).toEqual([0, 0, 255, 51])
      expect(Array.from(graph!.graph.linkWidths!)).toEqual([3])

      // The application moves a point; a recolor through its trigger must not undo it
      graph!.setPointPosition(0, 1000, 1030)
      await waitFrames(2)
      deck.setProps({ layers: [graphLayer(1)] })
      await waitUntil(() => graph!.graph.pointColors?.[1] === 1, 'the recolor')
      expect(Array.from(graph!.graph.pointColors!).map((c) => Math.round(c * 255))).toEqual([0, 255, 0, 128, 0, 255, 0, 128])
      expect(Array.from(graph!.getPointPositionsArray())).toEqual([1000, 1030, 1050, 1000])
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('hands Float32Array attributes to cosmos as they are, and converts byte colors', async () => {
    const colors = new Float32Array([0.5, 0.25, 1, 1, 0, 0, 0, 1])
    const sizes = new Float32Array([6, 8])
    const byteLinkColors = new Uint8Array([255, 0, 0, 51])
    let graph: Graph | undefined
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: {
          length: 2,
          initialPositions: new Float32Array([1000, 1000, 1050, 1000]),
          attributes: { getPointColor: { value: colors, size: 4 }, getPointSize: { value: sizes, size: 1 } },
        },
        links: { pairs: new Float32Array([0, 1]), attributes: { getLinkColor: { value: byteLinkColors, size: 4 } } },
        config: STATIC,
        onGraphCreated: (created): void => { graph = created },
      }),
    ])
    try {
      await waitUntil(() => (graph?.graph.pointColors?.length ?? 0) > 0, 'the first load')
      // cosmos's own form passes through by reference: zero copies for big graphs
      expect(graph!.graph.inputPointColors).toBe(colors)
      expect(Array.from(graph!.graph.pointSizes!)).toEqual([6, 8])
      expect(Array.from(graph!.graph.linkColors!).map((c) => Math.round(c * 255))).toEqual([255, 0, 0, 51])
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('passes deck\'s prop check with constant, function and unset style accessors', () => {
    const constants = new CosmosGraphLayer({
      id: 'graph',
      getPointSize: 4,
      getPointColor: [74, 92, 191, 230],
      getLinkColor: [0, 0, 255, 51],
      getLinkWidth: 1.5,
    })
    expect(() => constants.validateProps()).not.toThrow()
    const functions = new CosmosGraphLayer({ id: 'graph', getPointSize: (): number => 4, getLinkColor: (): [number, number, number] => [0, 0, 0] })
    expect(() => functions.validateProps()).not.toThrow()
    expect(() => new CosmosGraphLayer({ id: 'graph' }).validateProps()).not.toThrow()
  })

  it('leaves a style accessor that is left out to the config key, and cosmos\'s default under it', async () => {
    const points = { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) }
    const links = new Float32Array([0, 1])
    let graph: Graph | undefined
    const graphLayer = (config: CosmosGraphLayerConfig): CosmosGraphLayer => new CosmosGraphLayer({
      id: 'graph',
      points,
      links,
      config,
      onGraphCreated: (created): void => { graph = created },
    })
    const { deck, container } = await createDeck([graphLayer(STATIC)])
    try {
      await waitUntil(() => graph?.getPointSizes().length === 2, 'the first load')
      // Nothing uploaded: cosmos's own defaults draw
      expect(graph!.graph.inputPointColors).toBeUndefined()
      expect(bytes(graph!.getPointColors())).toEqual([179, 179, 179, 255, 179, 179, 179, 255])
      expect(Array.from(graph!.getPointSizes())).toEqual([4, 4])
      expect(bytes(graph!.getLinkColors())).toEqual([102, 102, 102, 255])
      expect(Array.from(graph!.getLinkWidths())).toEqual([1])

      // The config keys draw instead, and follow their changes
      deck.setProps({
        layers: [graphLayer({
          ...STATIC,
          pointDefaultColor: '#ff0000',
          pointDefaultSize: 20,
          linkDefaultColor: '#00ff00',
          linkDefaultWidth: 3,
        })],
      })
      await waitUntil(() => graph!.getPointSizes()[0] === 20, 'the config change')
      expect(bytes(graph!.getPointColors())).toEqual([255, 0, 0, 255, 255, 0, 0, 255])
      expect(bytes(graph!.getLinkColors())).toEqual([0, 255, 0, 255])
      expect(Array.from(graph!.getLinkWidths())).toEqual([3])
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('draws an accessor the app gives over the config key, and the key again once it is dropped', async () => {
    const points = { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) }
    const links = new Float32Array([0, 1])
    const config = { ...STATIC, pointDefaultSize: 20, linkDefaultColor: '#00ff00' }
    let graph: Graph | undefined
    const { deck, container } = await createDeck([new CosmosGraphLayer({
      id: 'graph',
      points,
      links,
      // The same values as the old defaults: an accessor given is uploaded, whatever its value
      getPointSize: 4,
      getLinkColor: [0, 0, 255, 255],
      config,
      onGraphCreated: (created): void => { graph = created },
    })])
    try {
      await waitUntil(() => graph?.getPointSizes().length === 2, 'the first load')
      expect(Array.from(graph!.getPointSizes())).toEqual([4, 4])
      expect(bytes(graph!.getLinkColors())).toEqual([0, 0, 255, 255])

      // The accessors dropped: the layer clears what it uploaded, and the keys draw
      deck.setProps({ layers: [new CosmosGraphLayer({ id: 'graph', points, links, config })] })
      await waitUntil(() => graph!.getPointSizes()[0] === 20, 'the dropped accessor')
      expect(bytes(graph!.getLinkColors())).toEqual([0, 255, 0, 255])
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('leaves the style arrays an app set on its own graph alone when it gives no accessor', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const provided = new Graph(null, STATIC, devicePromise)
    // The app styles its own graph
    provided.setPointColors(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1]))
    try {
      await provided.ready
      const layer = (initialPositions: Float32Array): CosmosGraphLayer => new CosmosGraphLayer({
        id: 'graph',
        graph: provided,
        points: { length: 2, initialPositions },
      })
      deck.setProps({ layers: [layer(new Float32Array([1000, 1000, 1050, 1000]))] })
      await waitUntil(() => provided.getPointPositionsArray().length === 4, 'the first load')
      expect(bytes(provided.getPointColors())).toEqual([255, 0, 0, 255, 255, 0, 0, 255])

      // A reload of the same count keeps them too
      deck.setProps({ layers: [layer(new Float32Array([1000, 1030, 1050, 1030]))] })
      await waitUntil(() => provided.getPointPositionsArray()[1] === 1030, 'the reload')
      expect(bytes(provided.getPointColors())).toEqual([255, 0, 0, 255, 255, 0, 0, 255])
    } finally {
      deck.finalize()
      container.remove()
      provided.destroy()
    }
  })

  it('rescales points it loads into a provided graph by the graph\'s own config', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const provided = new Graph(null, { ...STATIC, rescalePositions: true }, devicePromise)
    // The engine rescales in place, into the array it was given: compare to a snapshot
    const input = POSITIONS.slice()
    try {
      await provided.ready
      deck.setProps({
        layers: [new CosmosGraphLayer({ id: 'graph', graph: provided, points: { length: 3, initialPositions: POSITIONS.slice() } })],
      })
      await waitUntil(() => provided.getPointPositionsArray().length === 6, 'the load')
      expect(Array.from(provided.getPointPositionsArray())).not.toEqual(Array.from(input))
    } finally {
      deck.finalize()
      container.remove()
      provided.destroy()
    }
  })

  it('takes cosmos\'s config: rendering keys reach the graph, a dropped key returns to default, deck\'s keys are stripped', async () => {
    let graph: Graph | undefined
    const graphLayer = (config: CosmosGraphLayerConfig): CosmosGraphLayer => new CosmosGraphLayer({
      id: 'graph',
      points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
      config,
      onGraphCreated: (created): void => { graph = created },
    })
    const { deck, container } = await createDeck([
      // enableZoom is deck's to decide: the type forbids it, a JS caller is stripped
      graphLayer({ ...STATIC, curvedLinks: true, simulationLinkDistance: 77, ...({ enableZoom: false } as object) }),
    ])
    try {
      await waitUntil(() => Boolean(graph), 'the graph')
      expect(graph!.config.curvedLinks).toBe(true)
      expect(graph!.config.simulationLinkDistance).toBe(77)
      expect(graph!.config.enableZoom).toBe(defaultConfigValues.enableZoom)
      // cosmos sizes pixels at the ratio deck's canvas draws at
      const canvasContext = (deck as unknown as { device: Device }).device.canvasContext as { cssToDeviceRatio?: () => number } | null
      expect(graph!.config.pixelRatio).toBe(canvasContext?.cssToDeviceRatio?.() ?? window.devicePixelRatio)

      deck.setProps({ layers: [graphLayer({ ...STATIC, curvedLinks: true })] })
      await waitUntil(() => graph!.config.simulationLinkDistance === defaultConfigValues.simulationLinkDistance, 'the reset')
      expect(graph!.config.curvedLinks).toBe(true)
      expect(graph!.config.simulationGravity).toBe(0)
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('resolves array links by id, drops the ones that name no point, and reports each load with the mapping', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    type Point = { id: string; position: readonly [number, number] }
    type Link = { source: string; target: string; name: string }
    const points: Point[] = [{ id: 'a', position: [1000, 1000] }, { id: 'b', position: [1050, 1000] }, { id: 'c', position: [1000, 1030] }]
    // The middle link names no point: the graph holds the other two, in their order
    const links: Link[] = [{ source: 'a', target: 'b', name: 'ab' }, { source: 'a', target: 'nope', name: 'dropped' }, { source: 'b', target: 'c', name: 'bc' }]
    const STRENGTH: Record<string, number> = { ab: 0.25, bc: 0.75, ca: 0.5 }
    let created: Graph | undefined
    const loads: CosmosGraphDataLoadedInfo<Link>[] = []
    const heldPairs: number[][] = []
    const graphLayer = (
      linkData: CosmosGraphLinks<Link>,
      pointColor: [number, number, number, number] = [0, 0, 255, 255]
    ): CosmosGraphLayer<Point, Link> =>
      new CosmosGraphLayer<Point, Link>({
        id: 'graph',
        points,
        links: linkData,
        getPointId: (p): string => p.id,
        getPointPosition: (p): readonly [number, number] => p.position,
        getPointColor: pointColor,
        config: STATIC,
        onGraphCreated: (graph): void => { created = graph },
        onGraphDataLoaded: (info): void => {
          loads.push(info)
          heldPairs.push(Array.from(info.graph.graph.links ?? []))
          if (!info.links) return
          info.graph.setLinkStrength(Float32Array.from(info.links, (l) => STRENGTH[l.name] as number))
          info.graph.render()
        },
      })
    const { deck, container } = await createDeck([graphLayer(links)])
    try {
      await waitUntil(() => loads.length === 1, 'the first load')
      const [first] = loads
      expect(first?.graph).toBe(created)
      expect(first?.pointsLoaded).toBe(true)
      expect(first?.linksLoaded).toBe(true)
      expect(first?.pointIndexById?.get('c')).toBe(2)
      expect(first?.links?.map((l) => l.name)).toEqual(['ab', 'bc'])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 of 3 links'))
      // The reported links are the ones the graph holds, in its order
      const toPairs = (info: CosmosGraphDataLoadedInfo<Link> | undefined): number[] =>
        (info?.links ?? []).flatMap((l) => [info?.pointIndexById?.get(l.source) as number, info?.pointIndexById?.get(l.target) as number])
      expect(heldPairs[0]).toEqual(toPairs(first))
      // ...so the strengths sent from it are the ones the graph applies
      expect(Array.from(created!.graph.linkStrength ?? [])).toEqual([0.25, 0.75])

      // A restyle loads nothing, so there is nothing to report
      deck.setProps({ layers: [graphLayer(links, [255, 0, 0, 255])] })
      await waitUntil(() => created!.graph.pointColors?.[0] === 1, 'the restyle')
      expect(loads).toHaveLength(1)

      // New links, same points: reported as a links load, and what it sends lines up again
      const reordered: Link[] = [{ source: 'b', target: 'c', name: 'bc' }, { source: 'c', target: 'a', name: 'ca' }, { source: 'a', target: 'b', name: 'ab' }]
      deck.setProps({ layers: [graphLayer(reordered)] })
      await waitUntil(() => loads.length === 2, 'the second load')
      expect(loads[1]?.pointsLoaded).toBe(false)
      expect(loads[1]?.linksLoaded).toBe(true)
      expect(loads[1]?.links?.map((l) => l.name)).toEqual(['bc', 'ca', 'ab'])
      expect(heldPairs[1]).toEqual(toPairs(loads[1]))
      expect(Array.from(created!.graph.linkStrength ?? [])).toEqual([0.75, 0.5, 0.25])

      // Binary links are in the caller's own order: no links to report
      deck.setProps({ layers: [graphLayer(new Float32Array([0, 1]))] })
      await waitUntil(() => loads.length === 3, 'the third load')
      expect(loads[2]?.linksLoaded).toBe(true)
      expect(loads[2]?.links).toBeNull()
    } finally {
      warn.mockRestore()
      deck.finalize()
      container.remove()
    }
  })

  it('reports a provided graph and an id-only remap, and survives a callback that throws', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const provided = new Graph(null, STATIC, devicePromise)
    type Point = { id: string; alias: string }
    const points: Point[] = [{ id: 'a', alias: 'x' }, { id: 'b', alias: 'y' }]
    // One pair array throughout: a new one would be a links load
    const pairs = new Float32Array([0, 1])
    const loads: CosmosGraphDataLoadedInfo[] = []
    const errors: Error[] = []
    const created = vi.fn()
    const graphLayer = (getPointId: (p: Point) => string, trigger: number): CosmosGraphLayer<Point> => new CosmosGraphLayer<Point>({
      id: 'graph',
      graph: provided,
      points,
      links: pairs,
      getPointId,
      getPointPosition: (_, { index }): [number, number] => [1000 + index * 50, 1000],
      updateTriggers: { getPointId: trigger },
      onGraphCreated: created,
      onGraphDataLoaded: (info): void => {
        loads.push(info)
        // An app bug on the first load must not keep the layer from becoming ready
        if (loads.length === 1) throw new Error('app bug')
      },
      onError: (error): boolean => { errors.push(error); return true },
    })
    try {
      await provided.ready
      deck.setProps({ layers: [graphLayer((p) => p.id, 0)] })
      await waitUntil(() => loads.length === 1, 'the first load')
      expect(loads[0]?.graph).toBe(provided)
      expect(created).not.toHaveBeenCalled()
      expect(errors[0]?.message).toContain('onGraphDataLoaded')
      expect(errors[0]?.message).toContain('app bug')
      // The layer is ready in spite of the throw: it draws, so cosmos has deck's view
      await waitFrames(5)
      const [cx, cy] = provided.spaceToScreenPosition([1000, 1000])
      expect(cx).toBeCloseTo(CENTER.x, 3)
      expect(cy).toBeCloseTo(CENTER.y, 3)

      // New ids over the same positions and pairs: nothing reloads, but ids reach indices anew
      deck.setProps({ layers: [graphLayer((p) => p.alias, 1)] })
      await waitUntil(() => loads.length === 2, 'the remap')
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

  it('draws a provided graph without configuring, loading into, or destroying it', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provided = new Graph(null, { ...STATIC, simulationLinkDistance: 77 }, devicePromise)
    const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1])
    provided.setPointPositions(POSITIONS.slice(0, 4))
    provided.setPointColors(colors)
    provided.setLinks(new Float32Array([0, 1]))
    provided.render()
    const created = vi.fn()
    try {
      await provided.ready
      // No `points`: the layer draws what the graph holds. Its own accessors and config do not apply
      deck.setProps({
        layers: [new CosmosGraphLayer({
          id: 'graph',
          graph: provided,
          links: new Float32Array([1, 0]),
          getPointColor: [0, 0, 255, 255],
          config: { simulationLinkDistance: 5 },
          onGraphCreated: created,
        })],
      })
      await waitFrames(10)
      expect(created).not.toHaveBeenCalled()
      expect(provided.graph.inputPointColors).toBe(colors)
      expect(Array.from(provided.graph.links ?? [])).toEqual([0, 1])
      expect(provided.config.simulationLinkDistance).toBe(77)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('`links` is ignored without `points`'))
      // It draws: cosmos has deck's view
      const [cx, cy] = provided.spaceToScreenPosition([1000, 1000])
      expect(cx).toBeCloseTo(CENTER.x, 3)
      expect(cy).toBeCloseTo(CENTER.y, 3)

      // Removing the layer leaves the application's graph alone
      const destroy = vi.spyOn(provided, 'destroy')
      deck.setProps({ layers: [] })
      await waitFrames(5)
      expect(destroy).not.toHaveBeenCalled()
      expect(Array.from(provided.getPointPositionsArray())).toEqual([1000, 1000, 1050, 1000])
    } finally {
      warn.mockRestore()
      provided.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('refuses a provided graph on another device', async () => {
    const { deck, container } = await createDeck([])
    const other = new Graph(null, STATIC) // its own hidden device
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loaded = vi.fn()
    try {
      await other.ready
      deck.setProps({
        layers: [new CosmosGraphLayer({
          id: 'graph',
          graph: other,
          points: { length: 2, initialPositions: POSITIONS.slice(0, 4) },
          onGraphDataLoaded: loaded,
        })],
      })
      await waitUntil(() => error.mock.calls.length > 0, 'the device error')
      expect(error).toHaveBeenCalledWith(expect.stringContaining('different device'))
      await waitFrames(5)
      // Nothing was loaded into it
      expect(loaded).not.toHaveBeenCalled()
      expect(other.graph.pointsNumber ?? 0).toBe(0)
    } finally {
      error.mockRestore()
      other.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('steps itself from deck\'s timeline — no app render-loop wiring anywhere', async () => {
    let graph: Graph | undefined
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        links: new Float32Array([0, 1]),
        config: {
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
        onGraphCreated: (created): void => { graph = created },
      }),
    ])
    try {
      // Nothing here calls step(): the layer's timeline animation must move the linked points
      let x0 = 1000
      await waitUntil(() => {
        const positions = graph?.getPointPositionsArray()
        if (positions && positions.length >= 2) x0 = positions[0] as number
        return Math.abs(x0 - 1000) >= 8
      }, 'the points moving')
      expect(Math.abs(x0 - 1000)).toBeGreaterThanOrEqual(8)
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
        config: { ...STATIC, onSimulationTick: (): void => { ticks.count += 1 } },
      }),
    ])
    try {
      await waitUntil(() => ticks.count >= 5, 'five steps')
      await waitFrames(2)
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

  it('steps a graph shared by two layers once per frame', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    let ticks = 0
    const provided = new Graph(null, { ...STATIC, simulationDecay: 100000, onSimulationTick: (): void => { ticks += 1 } }, devicePromise)
    provided.setPointPositions(POSITIONS)
    provided.render()
    try {
      await provided.ready
      deck.setProps({
        layers: [
          new CosmosGraphLayer({ id: 'main', graph: provided }),
          new CosmosGraphLayer({ id: 'mini', graph: provided }),
        ],
      })
      await waitFrames(5)
      const before = ticks
      const frames = 20
      await waitFrames(frames)
      // Two layers, one step per frame: never twice per frame. (A frame or two may pass
      // without a step while deck idles between redraws.)
      expect(ticks - before).toBeGreaterThan(frames / 2)
      expect(ticks - before).toBeLessThanOrEqual(frames + 2)
    } finally {
      provided.destroy()
      deck.finalize()
      container.remove()
    }
  })

  it('picks points and links through deck: element type, index within it, and the original object', async () => {
    type Point = { id: string; position: readonly [number, number] }
    type Link = { source: string; target: string; name: string }
    const points: Point[] = [{ id: 'a', position: [1000, 1000] }, { id: 'b', position: [1050, 1000] }, { id: 'c', position: [1000, 1030] }]
    const links: Link[] = [{ source: 'a', target: 'b', name: 'ab' }]
    let graph: Graph | undefined
    const { deck, container } = await createDeck([
      new CosmosGraphLayer<Point, Link>({
        id: 'graph',
        points,
        links,
        getPointId: (p): string => p.id,
        getPointPosition: (p): readonly [number, number] => p.position,
        getPointSize: 10,
        getLinkWidth: 6,
        config: STATIC,
        onGraphCreated: (created): void => { graph = created },
        pickable: true,
      }),
    ])
    try {
      await waitUntil(() => deck.pickObject({ ...CENTER, radius: 2 }) !== null, 'the first pick')
      const point = deck.pickObject({ ...CENTER, radius: 2 }) as CosmosGraphPickingInfo
      expect(point.elementType).toBe('point')
      expect(point.index).toBe(0)
      expect(point.object).toEqual(points[0])
      expect(point.layer?.id).toBe('graph')
      const other = deck.pickObject({ ...worldToScreen(1000, 1030), radius: 2 }) as CosmosGraphPickingInfo
      expect(other.elementType).toBe('point')
      expect(other.index).toBe(2)

      // The link between a and b, at its middle: its own index space
      const link = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as CosmosGraphPickingInfo
      expect(link.elementType).toBe('link')
      expect(link.index).toBe(0)
      expect(link.object).toEqual(links[0])

      // Empty space picks nothing
      expect(deck.pickObject({ x: 20, y: 180, radius: 2 })).toBeNull()

      // Picking follows the live positions: move a point and pick it where it went
      graph!.setPointPosition(2, 1000, 1060)
      await waitFrames(3)
      expect((deck.pickObject({ ...worldToScreen(1000, 1060), radius: 2 }) as CosmosGraphPickingInfo | null)?.index).toBe(2)
      expect(deck.pickObject({ ...worldToScreen(1000, 1030), radius: 0 })).toBeNull()
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('highlights the hovered element with cosmos\'s hover ring and hovered-link width, leaving focus alone', async () => {
    let graph: Graph | undefined
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        links: new Float32Array([0, 1]),
        getPointSize: 10,
        getLinkWidth: 6,
        config: STATIC,
        onGraphCreated: (created): void => { graph = created },
        pickable: true,
        autoHighlight: true,
      }),
    ])
    try {
      await waitUntil(() => deck.pickObject({ ...CENTER, radius: 2 }) !== null, 'the first pick')
      const store = graph!.simulation.store
      const point = deck.pickObject({ ...CENTER, radius: 2 }) as PickingInfo
      const layer = point.layer as Layer
      layer.updateAutoHighlight({ ...point, picked: true })
      expect(store.hostHoveredPointIndex).toBe(0)
      expect(store.hostHoveredLinkIndex).toBeUndefined()

      const link = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as PickingInfo
      layer.updateAutoHighlight({ ...link, picked: true })
      expect(store.hostHoveredLinkIndex).toBe(0)
      expect(store.hostHoveredPointIndex).toBeUndefined()

      // Leaving clears both, and focus was never written
      layer.updateAutoHighlight({ ...link, picked: false, index: -1 })
      expect(store.hostHoveredPointIndex).toBeUndefined()
      expect(store.hostHoveredLinkIndex).toBeUndefined()
      expect(graph!.config.focusedPointIndex).toBeUndefined()
      expect(graph!.config.focusedLinkIndex).toBeUndefined()
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('keeps the app\'s focus through a hover, and the hover through a config change', async () => {
    let graph: Graph | undefined
    const graphLayer = (config: CosmosGraphLayerConfig): CosmosGraphLayer => new CosmosGraphLayer({
      id: 'graph',
      points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
      getPointSize: 10,
      config,
      onGraphCreated: (created): void => { graph = created },
      pickable: true,
      autoHighlight: true,
    })
    // The app focuses point 1 itself
    const { deck, container } = await createDeck([graphLayer({ ...STATIC, focusedPointIndex: 1 })])
    try {
      await waitUntil(() => deck.pickObject({ ...CENTER, radius: 2 }) !== null, 'the first pick')
      const store = graph!.simulation.store

      // Hovering point 0 rings it; the app's focus stays on point 1
      const point = deck.pickObject({ ...CENTER, radius: 2 }) as PickingInfo
      const layer = point.layer as Layer
      layer.updateAutoHighlight({ ...point, picked: true })
      expect(graph!.config.focusedPointIndex).toBe(1)
      expect(store.hostHoveredPointIndex).toBe(0)

      // A config change mid-hover rebuilds the graph's config: the hover survives it
      deck.setProps({ layers: [graphLayer({ ...STATIC, focusedPointIndex: 1, simulationGravity: 0.5 })] })
      await waitUntil(() => graph!.config.simulationGravity === 0.5, 'the config change')
      expect(store.hostHoveredPointIndex).toBe(0)
      expect(graph!.config.focusedPointIndex).toBe(1)

      const current = deck.pickObject({ ...CENTER, radius: 2 }) as PickingInfo
      ;(current.layer as Layer).updateAutoHighlight({ ...current, picked: false, index: -1 })
      expect(store.hostHoveredPointIndex).toBeUndefined()
      expect(graph!.config.focusedPointIndex).toBe(1)
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('hovers a provided graph without touching its focus: a click during the hover sticks', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    // The app's graph, with its own focus and data; the layer gets no config and no points
    const provided = new Graph(null, { ...STATIC, focusedPointIndex: 1, focusedLinkIndex: 0 }, devicePromise)
    provided.setPointPositions(new Float32Array([1000, 1000, 1050, 1000]))
    provided.setLinks(new Float32Array([0, 1]))
    provided.setPointSizes(new Float32Array([10, 10]))
    provided.setLinkWidths(new Float32Array([6]))
    provided.render()
    try {
      await provided.ready
      deck.setProps({ layers: [new CosmosGraphLayer({ id: 'graph', graph: provided, pickable: true, autoHighlight: true })] })
      await waitUntil(() => deck.pickObject({ ...CENTER, radius: 2 }) !== null, 'the first pick')
      const store = provided.simulation.store

      // Hovering a point and then a link leaves the graph's own focus as it was
      const point = deck.pickObject({ ...CENTER, radius: 2 }) as PickingInfo
      const layer = point.layer as Layer
      layer.updateAutoHighlight({ ...point, picked: true })
      expect(provided.config.focusedPointIndex).toBe(1)
      expect(store.hostHoveredPointIndex).toBe(0)
      const link = deck.pickObject({ ...worldToScreen(1025, 1000), radius: 2 }) as PickingInfo
      layer.updateAutoHighlight({ ...link, picked: true })
      expect(provided.config.focusedPointIndex).toBe(1)
      expect(provided.config.focusedLinkIndex).toBe(0)
      layer.updateAutoHighlight({ ...link, picked: false, index: -1 })
      expect(provided.config.focusedPointIndex).toBe(1)
      expect(provided.config.focusedLinkIndex).toBe(0)

      // The app selects the point under the pointer; leaving keeps the selection
      layer.updateAutoHighlight({ ...point, picked: true })
      provided.setConfigPartial({ focusedPointIndex: 0 })
      layer.updateAutoHighlight({ ...point, picked: false, index: -1 })
      expect(provided.config.focusedPointIndex).toBe(0)

      // Removing the layer mid-hover takes its hover off the app's graph
      layer.updateAutoHighlight({ ...point, picked: true })
      expect(store.hostHoveredPointIndex).toBe(0)
      deck.setProps({ layers: [] })
      await waitUntil(() => store.hostHoveredPointIndex === undefined, 'the layer\'s removal')
    } finally {
      deck.finalize()
      container.remove()
      provided.destroy()
    }
  })

  it('keeps the hover when a layer that holds none is removed from the shared graph', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const provided = new Graph(null, STATIC, devicePromise)
    provided.setPointPositions(new Float32Array([1000, 1000, 1050, 1000]))
    provided.setPointSizes(new Float32Array([10, 10]))
    provided.render()
    const main = new CosmosGraphLayer({ id: 'main', graph: provided, pickable: true, autoHighlight: true })
    const thumb = new CosmosGraphLayer({ id: 'thumb', graph: provided })
    try {
      await provided.ready
      // One graph, two layers: the main one highlights, the second one only draws
      deck.setProps({ layers: [main, thumb] })
      await waitUntil(() => deck.pickObject({ ...CENTER, radius: 2 }) !== null, 'the first pick')
      const point = deck.pickObject({ ...CENTER, radius: 2 }) as PickingInfo
      ;(point.layer as Layer).updateAutoHighlight({ ...point, picked: true })
      expect(provided.simulation.store.hostHoveredPointIndex).toBe(0)

      deck.setProps({ layers: [main] })
      await waitUntil(() => thumb.lifecycle.startsWith('Finalized'), 'the second layer\'s removal')
      expect(provided.simulation.store.hostHoveredPointIndex).toBe(0)
    } finally {
      deck.finalize()
      container.remove()
      provided.destroy()
    }
  })

  it('drags a point: pins on start, moves it to the pointer through cosmos\'s view, releases on end', async () => {
    let graph: Graph | undefined
    const dragEnd = vi.fn()
    const { deck, container } = await createDeck([
      new CosmosGraphLayer({
        id: 'graph',
        points: { length: 2, initialPositions: new Float32Array([1000, 1000, 1050, 1000]) },
        getPointSize: 10,
        config: STATIC,
        onGraphCreated: (created): void => { graph = created },
        pickable: true,
        enablePointDrag: true,
        dragReheatAlpha: null,
        onPointDragEnd: dragEnd,
      }),
    ])
    try {
      await waitUntil(() => deck.pickObject({ ...CENTER, radius: 2 }) !== null, 'the first pick')
      const info = deck.pickObject({ ...CENTER, radius: 2 }) as PickingInfo
      const layer = info.layer as CosmosGraphLayer
      expect(layer.onDragStart(info, {})).toBe(true)
      expect(graph!.graph.inputPinnedPoints).toContain(0)

      // The pointer at (150, 70) is space (1050, 1030) under this view: y up
      expect(layer.onDrag({ ...info, x: 150, y: 70 }, {})).toBe(true)
      const positions = graph!.getPointPositionsArray()
      expect(positions[0]).toBeCloseTo(1050, 2)
      expect(positions[1]).toBeCloseTo(1030, 2)

      expect(layer.onDragEnd({ ...info, x: 150, y: 70 }, {})).toBe(true)
      expect(graph!.graph.inputPinnedPoints ?? []).not.toContain(0)
      expect(dragEnd).toHaveBeenCalledTimes(1)

      // Off a point, a drag is the view's
      expect(layer.onDragStart({ ...info, index: -1, picked: false }, {})).toBe(false)
    } finally {
      deck.finalize()
      container.remove()
    }
  })

  it('maps a drag through the viewport the pointer is in, not the view cosmos drew last', async () => {
    const { deck, container, devicePromise } = createDeckDevice()
    const provided = new Graph(null, STATIC, devicePromise)
    // One point, at pixel (60, 140) of the main view — outside the thumbnail's quadrant
    provided.setPointPositions(new Float32Array([960, 960]))
    provided.setPointSizes(new Float32Array([10]))
    provided.render()
    try {
      await provided.ready
      // The same graph in two views: the main one and a quarter-scale thumbnail drawn
      // after it, so the view cosmos holds at drag time is the thumbnail's
      ;(deck as unknown as Deck<OrthographicView[]>).setProps({
        views: [
          new OrthographicView({ id: 'main', flipY: false }),
          new OrthographicView({ id: 'thumb', x: 100, y: 0, width: 100, height: 100, flipY: false }),
        ],
        viewState: {
          main: { target: [1000, 1000, 0], zoom: 0 },
          thumb: { target: [1000, 1000, 0], zoom: -2 },
        },
        layerFilter: ({ layer, viewport }): boolean => layer.id === viewport.id,
        layers: [
          new CosmosGraphLayer({ id: 'main', graph: provided, pickable: true, enablePointDrag: true, dragReheatAlpha: null }),
          new CosmosGraphLayer({ id: 'thumb', graph: provided }),
        ],
      })
      await waitUntil(() => deck.pickObject({ x: 60, y: 140, radius: 2 }) !== null, 'the first pick')
      const info = deck.pickObject({ x: 60, y: 140, radius: 2 }) as PickingInfo
      expect(info.layer?.id).toBe('main')
      const layer = info.layer as CosmosGraphLayer
      expect(layer.onDragStart(info, {})).toBe(true)
      // A frame between the grab and the move, as in any real drag: it draws the main
      // view and then the thumbnail, which leaves cosmos holding the thumbnail's view
      deck.redraw('drag')
      await waitFrames(1)

      // (80, 120) in the main view is space (980, 980); through the thumbnail's view it would be far off
      expect(layer.onDrag({ ...info, x: 80, y: 120 }, {})).toBe(true)
      const positions = provided.getPointPositionsArray()
      expect(positions[0]).toBeCloseTo(980, 1)
      expect(positions[1]).toBeCloseTo(980, 1)
      expect(layer.onDragEnd({ ...info, x: 80, y: 120 }, {})).toBe(true)
    } finally {
      deck.finalize()
      container.remove()
      provided.destroy()
    }
  })

  it('seeds unpositioned points from the graph\'s RNG, so randomSeed reproduces the layout', async () => {
    const layouts: number[][] = []
    const graphLayer = (): CosmosGraphLayer => new CosmosGraphLayer({
      id: 'graph',
      points: { length: 3 },
      config: { ...STATIC, randomSeed: 7 },
      onGraphDataLoaded: ({ graph }): void => { layouts.push(Array.from(graph.getPointPositionsArray())) },
    })
    const { deck, container } = await createDeck([graphLayer()])
    try {
      await waitUntil(() => layouts.length === 1, 'the first load')
      // A second layer is a second graph with the same seed
      deck.setProps({ layers: [] })
      await waitFrames(2)
      deck.setProps({ layers: [graphLayer()] })
      await waitUntil(() => layouts.length === 2, 'the second load')
      expect(layouts[1]).toEqual(layouts[0])
      // Still in the middle half of the space, clear of the walls
      const spaceSize = defaultConfigValues.spaceSize
      for (const coordinate of layouts[0] as number[]) {
        expect(coordinate).toBeGreaterThanOrEqual(spaceSize * 0.25)
        expect(coordinate).toBeLessThanOrEqual(spaceSize * 0.75)
      }
    } finally {
      deck.finalize()
      container.remove()
    }
  })
})
