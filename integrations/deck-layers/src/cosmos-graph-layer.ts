import { COORDINATE_SYSTEM, Layer } from '@deck.gl/core'
import type {
  Accessor,
  AccessorContext,
  BinaryAttribute,
  Color,
  DefaultProps,
  LayerContext,
  LayerProps,
  UpdateParameters,
} from '@deck.gl/core'
import { Graph } from '@cosmos.gl/graph'
import type { GraphConfig } from '@cosmos.gl/graph'

/**
 * Binary styling channels for binary points, keyed by the accessor each one
 * replaces. Colors are RGBA per point, 4 values each: a `Uint8Array` in
 * 0..255 (deck's convention) is converted, a `Float32Array` is cosmos's own
 * 0..1 and is handed over as it is. Sizes are one value per point, handed
 * over as they are. Values are read tightly packed; `offset` and `stride` are
 * not honoured.
 */
export type CosmosPointAttributes = {
  getPointColor?: BinaryAttribute;
  getPointSize?: BinaryAttribute;
}

/**
 * Points input: an array to run accessors over, or the cosmos-native binary
 * form — a point count plus optional `[x0, y0, x1, y1, …]` initial positions
 * and binary styling channels. Points without given positions are seeded
 * randomly inside the simulation space.
 */
export type CosmosGraphPoints<PointDataT> = readonly PointDataT[] | {
  length: number;
  initialPositions?: Float32Array;
  attributes?: CosmosPointAttributes;
}

/**
 * Binary styling channels for binary links, keyed by the accessor each one
 * replaces, with the same conventions as `CosmosPointAttributes`: colors a
 * `Uint8Array` in 0..255 or a `Float32Array` in 0..1, widths one per link.
 */
export type CosmosLinkAttributes = {
  getLinkColor?: BinaryAttribute;
  getLinkWidth?: BinaryAttribute;
}

/**
 * Links input: an array to run accessors over, the cosmos-native
 * `[source0, target0, source1, target1, …]` array of point indices, or that
 * array as `pairs` with binary styling channels beside it. An array link whose
 * source or target does not resolve to a point is dropped, with one warning
 * per data change; a pair that names no point is skipped by the engine and
 * keeps its index.
 */
export type CosmosGraphLinks<LinkDataT> = readonly LinkDataT[] | Float32Array | {
  pairs: Float32Array;
  attributes?: CosmosLinkAttributes;
}

/**
 * The cosmos.gl config keys deck owns in this embedding — the canvas, the view
 * and its zoom, the frame loop, the pointer and its callbacks. The layer strips
 * them from `config`: deck's view state, controller, event callbacks and
 * `useDevicePixels` are the way to those things.
 */
export const DECK_OWNED_CONFIG_KEYS = [
  'enableRenderLoop', 'backgroundColor', 'pixelRatio', 'showFPSMonitor', 'attribution',
  'hoveredPointCursor', 'hoveredLinkCursor',
  'initialZoomLevel', 'enableZoom', 'enableSimulationDuringZoom', 'enableDrag',
  'fitViewOnInit', 'fitViewDelay', 'fitViewPadding', 'fitViewDuration', 'fitViewByPointsInRect', 'fitViewByPointIndices',
  'simulationRepulsionFromMouse', 'enableRightClickRepulsion',
  'onClick', 'onPointClick', 'onLinkClick', 'onBackgroundClick',
  'onContextMenu', 'onPointContextMenu', 'onLinkContextMenu', 'onBackgroundContextMenu',
  'onMouseMove', 'onPointMouseOver', 'onPointMouseOut', 'onLinkMouseOver', 'onLinkMouseOut',
  'onZoomStart', 'onZoom', 'onZoomEnd', 'onDragStart', 'onDrag', 'onDragEnd',
] as const satisfies readonly (keyof GraphConfig)[]

/**
 * cosmos.gl's configuration as the layer takes it: every key of `GraphConfig`
 * except the ones deck owns (`DECK_OWNED_CONFIG_KEYS`). Rendering keys work as
 * in cosmos.gl, because cosmos.gl does the rendering. The transition keys have
 * no effect: a headless `Graph` applies data changes at once.
 */
export type CosmosGraphLayerConfig = Omit<GraphConfig, (typeof DECK_OWNED_CONFIG_KEYS)[number]>

/**
 * What `onGraphDataLoaded` reports: the graph, what the load replaced, and how
 * your data maps to the graph's point and link indices. Per-point and per-link
 * arrays you hand the graph (`setLinkStrength`, `setPointShapes`,
 * `setPointClusters`, …) follow those indices. `links` and `pointIndexById`
 * are the layer's own state: read or copy them, never mutate them.
 */
export type CosmosGraphDataLoadedInfo<LinkDataT = unknown> = {
  /** The graph the data was loaded into: layer-created or provided. */
  graph: Graph;
  /**
   * The point positions were replaced, and with them possibly the point count.
   * Per-point arrays sent before this load may no longer line up.
   */
  pointsLoaded: boolean;
  /**
   * The links were replaced. Per-link arrays sent before this load may no longer
   * line up: the engine reuses the last one it was sent whenever its length
   * matches the new link count, in the old order.
   */
  linksLoaded: boolean;
  /**
   * Point `i` is always entry `i` of `points` (or pair `i` of `initialPositions`).
   * With array points and `getPointId`, this maps each id to its index; a repeated
   * id maps to its last point. Otherwise `null`.
   */
  pointIndexById: ReadonlyMap<string | number, number> | null;
  /**
   * Array links: the links the graph holds, in its order — link `i` is
   * `info.links[i]`. Links whose endpoints name no point are not among them, so
   * an index into your `links` array can differ. Binary links, or no `links`
   * prop: `null`, and link `i` is pair `i` of your pair array.
   */
  links: readonly LinkDataT[] | null;
}

export type CosmosGraphLayerProps<PointDataT = unknown, LinkDataT = unknown> =
  CosmosGraphLayerOwnProps<PointDataT, LinkDataT> & LayerProps

type CosmosGraphLayerOwnProps<PointDataT, LinkDataT> = {
  /**
   * One entry per point — an array of your objects, or `{ length, initialPositions?, attributes? }`.
   * The layer loads them, with `links` and the styling accessors, into the graph. Omit it to
   * draw the data the graph already holds instead: the layer then writes nothing into the
   * graph, styling accessors included — the mode for an application-loaded `graph`.
   */
  points?: CosmosGraphPoints<PointDataT> | null;
  /** One entry per link — an array of your objects, or a flat point-index pair array. Ignored without `points`. */
  links?: CosmosGraphLinks<LinkDataT> | null;
  /**
   * Stable point id accessor. When provided (with array points), link
   * accessors may return ids instead of point indices.
   */
  getPointId?: Accessor<PointDataT, string | number> | null;
  /**
   * Initial `[x, y]` position accessor for array points, in cosmos space
   * coordinates; points it leaves undefined are seeded randomly.
   */
  getPointPosition?: Accessor<PointDataT, readonly [number, number] | null | undefined> | null;
  /**
   * Point size accessor, in cosmos.gl's units: pixels at zoom 1, scaled with the view
   * when `config.scalePointsOnZoom` is on, times `config.pointSizeScale`. `0` hides the point.
   * @default 4
   */
  getPointSize?: Accessor<PointDataT, number>;
  /**
   * Point RGBA color accessor, channels in 0..255 (deck's convention; converted for cosmos).
   * @default [74, 92, 191, 230]
   */
  getPointColor?: Accessor<PointDataT, Color>;
  /**
   * Source accessor for array links: a point index, or a point id when
   * `getPointId` is set.
   * @default l => l.source
   */
  getLinkSource?: Accessor<LinkDataT, string | number>;
  /**
   * Target accessor for array links: a point index, or a point id when
   * `getPointId` is set.
   * @default l => l.target
   */
  getLinkTarget?: Accessor<LinkDataT, string | number>;
  /**
   * Link RGBA color accessor, channels in 0..255.
   * @default [94, 115, 194, 64]
   */
  getLinkColor?: Accessor<LinkDataT, Color>;
  /**
   * Link width accessor, in cosmos.gl's units (see `config.scaleLinksOnZoom`, `config.linkWidthScale`).
   * @default 1
   */
  getLinkWidth?: Accessor<LinkDataT, number>;
  /**
   * cosmos.gl's configuration — forces, space size, rendering options such as
   * `curvedLinks`, `pointDefaultShape`, `linkDefaultArrows`, the simulation
   * callbacks — passed to the layer-created `Graph`. A key left out goes back
   * to the engine default. Ignored when `graph` is provided.
   */
  config?: CosmosGraphLayerConfig;
  /**
   * An application-owned headless `Graph` to draw instead of creating one:
   * `new Graph(null, config, devicePromise)` with the device from deck's
   * `onDeviceInitialized`. The layer steps it while it runs (`pause()` it to
   * take over stepping, then `deck.redraw()` after each manual `step()`) and
   * draws it; it never configures or destroys it — `config` and
   * `onGraphCreated` apply only to a layer-created graph, and teardown is the
   * application's, before `deck.finalize()`.
   *
   * `points` decides who loads the data. Given, the layer loads `points`,
   * `links` and the styling accessors into the graph once the device check has
   * passed, over whatever it held. Omitted, the layer draws the graph's own
   * data and writes nothing. Several layers may draw one graph — it steps once
   * per frame however many draw it — as long as at most one of them loads data.
   */
  graph?: Graph | null;
  /**
   * Called once with the layer-created `Graph` — the whole cosmos.gl API for
   * what the props do not cover: pause, pin, reheat, shapes, clusters, trackers,
   * sparse position writes. Not called for a provided `graph`.
   */
  onGraphCreated?: ((graph: Graph) => void) | null;
  /**
   * Called after each load of `points` or `links` into the graph, once the
   * graph holds the new data — and, with both load flags `false`, when only the
   * id map changed. Use it to send what lines up with the graph's indices —
   * link strengths, shapes, arrows, clusters, pins — again after a reload:
   * `info.pointIndexById` and `info.links` map your data to those indices.
   * Not called when the layer draws a graph's own data (no `points`).
   *
   * The first call comes when the graph is ready (and again after a `graph`
   * swap), later ones during deck's layer update. Calls on `info.graph` are
   * fine in either; defer anything that changes layer props. A throw goes to
   * deck's `onError`, and the load stands.
   */
  onGraphDataLoaded?: ((info: CosmosGraphDataLoadedInfo<LinkDataT>) => void) | null;
}

const defaultProps: DefaultProps<CosmosGraphLayerProps> = {
  points: { type: 'object', value: null, optional: true },
  links: null,
  getPointId: { type: 'accessor', value: null },
  getPointPosition: { type: 'accessor', value: null },
  getPointSize: { type: 'accessor', value: 4 },
  getPointColor: { type: 'accessor', value: [74, 92, 191, 230] },
  getLinkSource: { type: 'accessor', value: (l: unknown) => (l as { source: number }).source },
  getLinkTarget: { type: 'accessor', value: (l: unknown) => (l as { target: number }).target },
  getLinkColor: { type: 'accessor', value: [94, 115, 194, 64] },
  getLinkWidth: { type: 'accessor', value: 1 },
  config: { type: 'object', value: {}, compare: 2 },
  graph: { type: 'object', value: null, optional: true },
  onGraphCreated: { type: 'function', value: null, optional: true },
  onGraphDataLoaded: { type: 'function', value: null, optional: true },
  // cosmos draws its space coordinates as world coordinates; `modelMatrix` places the space
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
}

/** The update-trigger keys the layer reads. */
type CosmosUpdateTriggers = {
  all?: unknown;
  getPointId?: unknown;
  getPointPosition?: unknown;
  getPointSize?: unknown;
  getPointColor?: unknown;
  getLinkSource?: unknown;
  getLinkTarget?: unknown;
  getLinkColor?: unknown;
  getLinkWidth?: unknown;
}

/** Resolves a deck accessor (function or constant) for one object. */
const resolveAccessor = <In, Out>(accessor: Accessor<In, Out>, object: In, info: AccessorContext<In>): Out =>
  typeof accessor === 'function' ? (accessor as (o: In, i: AccessorContext<In>) => Out)(object, info) : accessor

/**
 * As deck compares its own accessors: replacing a function counts only through
 * the update trigger; replacing a constant, or switching to or from one, counts.
 */
const accessorReplaced = (next: unknown, previous: unknown): boolean =>
  next !== previous && !(typeof next === 'function' && typeof previous === 'function')

/** deck's `compare: 2` for the config: keys shallow, arrays by element. */
const configEquals = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean => {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => {
    const x = a[key]
    const y = b[key]
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => v === y[i])
    return x === y
  })
}

/**
 * RGBA per element as cosmos takes it (0..1), from a binary attribute or an
 * accessor. A `Float32Array` attribute is cosmos's own form and passes through.
 */
const toColorArray = <In>(
  count: number,
  accessor: Accessor<In, Color>,
  objects: readonly In[] | null,
  attribute: BinaryAttribute | undefined
): Float32Array => {
  if (attribute) {
    const { value } = attribute
    return value instanceof Float32Array ? value : Float32Array.from(value as ArrayLike<number>, (channel) => channel / 255)
  }
  const colors = new Float32Array(count * 4)
  const data = objects ?? { length: count }
  for (let i = 0; i < count; i += 1) {
    const color = resolveAccessor(accessor, objects?.[i] as In, { index: i, data, target: [] })
    colors[i * 4] = (color[0] as number) / 255
    colors[i * 4 + 1] = (color[1] as number) / 255
    colors[i * 4 + 2] = (color[2] as number) / 255
    colors[i * 4 + 3] = (color[3] ?? 255) / 255
  }
  return colors
}

/** One value per element, from a binary attribute (passed through) or an accessor. */
const toValueArray = <In>(
  count: number,
  accessor: Accessor<In, number>,
  objects: readonly In[] | null,
  attribute: BinaryAttribute | undefined
): Float32Array => {
  if (attribute) {
    const { value } = attribute
    return value instanceof Float32Array ? value : Float32Array.from(value as ArrayLike<number>)
  }
  const values = new Float32Array(count)
  const data = objects ?? { length: count }
  for (let i = 0; i < count; i += 1) {
    values[i] = resolveAccessor(accessor, objects?.[i] as In, { index: i, data, target: [] })
  }
  return values
}

/**
 * When each graph last stepped, by timeline time: layers drawing the same graph
 * share one step per frame instead of each taking their own.
 */
const steppedAt = new WeakMap<Graph, number>()

/** What the layer loaded when binary points carried no `initialPositions`: a seed of its own. */
const SEEDED = Symbol('seeded')
const NO_LINKS = new Float32Array(0)

/**
 * The cosmos.gl graph layer: give it points and links, and cosmos.gl lays them
 * out and draws them under deck's camera. The layer creates a headless `Graph`
 * on deck's device (or draws the application's, via `graph`), loads the data —
 * or, without `points`, leaves the graph's own data alone — advances the
 * simulation once per animation frame from deck's shared timeline while it runs
 * (deck goes idle when it settles), hands deck's view to cosmos.gl before each
 * draw and records cosmos.gl's own point and link draws into deck's render
 * pass. Everything cosmos.gl renders is available through `config` and the
 * `Graph` handle: shapes, arrows, dashes, curves, greyout, rings.
 *
 * The view: cosmos.gl's is a uniform scale plus a translation with y up, so
 * the layer draws under an `OrthographicView({ flipY: false })` or a map view
 * at pitch 0 and bearing 0, with `modelMatrix` placing the space in the world.
 * A rotated, pitched or y-down view is reported once and not drawn.
 *
 * Not yet: cosmos.gl draws into no picking buffer, so deck's `pickable`,
 * `autoHighlight`, hover and click see nothing of the graph.
 */
export class CosmosGraphLayer<PointDataT = unknown, LinkDataT = unknown> extends Layer<
  Required<CosmosGraphLayerOwnProps<PointDataT, LinkDataT>>
> {
  public static layerName = 'CosmosGraphLayer'
  public static defaultProps = defaultProps

  declare public state: {
    graph?: Graph;
    /** The `graph` prop this state was built from; `null` when the layer created its own. */
    providedGraph: Graph | null;
    isReady: boolean;
    /** `points` changed before the graph was ready: load them once it is. */
    isIngestPending: boolean;
    pointCount: number;
    linkCount: number;
    /**
     * Load mode: what the graph holds, so a channel reloads only when its own input
     * changes and a restyle leaves the layout alone. `loadedPositions` is the
     * `initialPositions` array, `SEEDED`, or the points array; `loadedPairs` the pair
     * array sent last; `idToIndex` the id map of the loaded points; `keptLinks` the
     * array links the graph holds, in its order.
     */
    hasLoaded: boolean;
    loadedPositions?: unknown;
    loadedPairs?: Float32Array | null;
    idToIndex?: Map<string | number, number> | null;
    keptLinks: readonly LinkDataT[] | null;
    /** The view was found unsupported and said so; said once. */
    viewWarned?: boolean;
    linksWarned?: boolean;
    animationHandle?: number;
  }

  public get isLoaded (): boolean {
    return super.isLoaded && Boolean(this.state?.isReady)
  }

  public initializeState (): void {
    const { device, timeline } = this.context
    if (device.type !== 'webgl') {
      throw new Error(
        `@cosmos.gl/deck-layers requires a WebGL 2 device — cosmos.gl is WebGL-only, got '${device.type}'`
      )
    }

    this.state = {
      providedGraph: null,
      isReady: false,
      isIngestPending: false,
      hasLoaded: false,
      pointCount: 0,
      linkCount: 0,
      keptLinks: null,
      // Step the simulation exactly once per animation frame, independent of
      // draw passes (draw runs per viewport)
      animationHandle: timeline.attachAnimation({ setTime: (time) => this._onTimelineTick(time) }),
    }
    this._attachGraph(this.props.graph ?? null)
  }

  public updateState (params: UpdateParameters<this>): void {
    super.updateState(params)
    const { props, oldProps, changeFlags } = params
    // Swapping graphs loads the current data into the new one, or follows it
    const providedGraph = props.graph ?? null
    const graphSwapped = providedGraph !== this.state.providedGraph
    if (graphSwapped) {
      this._releaseGraph()
      this._attachGraph(providedGraph)
    }
    const graph = this.state.graph
    if (!graph) return

    if (!providedGraph && !graphSwapped && !configEquals(props.config, oldProps.config)) {
      // Graph.setConfig starts from the defaults: a key left out goes back to its default
      graph.setConfig(this._graphConfig())
    }

    const triggers = typeof changeFlags.updateTriggersChanged === 'object'
      ? changeFlags.updateTriggersChanged as CosmosUpdateTriggers
      : undefined
    const triggered = (key: keyof CosmosUpdateTriggers): boolean => Boolean(triggers?.all || triggers?.[key])
    // Array links resolve against the id map and the position accessor at load,
    // so a change to either counts as a change of that channel
    const pointsChanged = graphSwapped || props.points !== oldProps.points || triggered('getPointPosition')
    const idsChanged = triggered('getPointId')
    const linksChanged = graphSwapped || props.links !== oldProps.links ||
      triggered('getLinkSource') || triggered('getLinkTarget') || idsChanged
    // Styles follow their accessors (a constant by value, a function by trigger) and
    // ride along with a new points or links object, which may carry new attributes
    const pointStyleChanged = pointsChanged || triggered('getPointColor') || triggered('getPointSize') ||
      accessorReplaced(props.getPointColor, oldProps.getPointColor) || accessorReplaced(props.getPointSize, oldProps.getPointSize)
    const linkStyleChanged = linksChanged || triggered('getLinkColor') || triggered('getLinkWidth') ||
      accessorReplaced(props.getLinkColor, oldProps.getLinkColor) || accessorReplaced(props.getLinkWidth, oldProps.getLinkWidth)
    if (!pointsChanged && !linksChanged && !pointStyleChanged && !linkStyleChanged) return

    if (props.points) {
      // The layer's data goes into the graph — once the device check has passed
      if (this.state.isReady) this._load({ pointsChanged, linksChanged, idsChanged, pointStyleChanged, linkStyleChanged })
      else this.state.isIngestPending = true
    } else {
      // No data of its own: the layer draws what the graph holds and writes nothing
      if (props.links && !this.state.linksWarned) {
        this.state.linksWarned = true
        console.warn('@cosmos.gl/deck-layers: `links` is ignored without `points` — load them into the graph instead')
      }
      this.state.isIngestPending = false
      this.state.hasLoaded = false
    }
  }

  public draw (opts: { shaderModuleProps?: { picking?: { isActive?: number | boolean } } }): void {
    const { graph, isReady } = this.state
    if (!graph || !isReady) return
    // cosmos draws colors, not picking colors: nothing of it belongs in deck's pick pass
    if (opts.shaderModuleProps?.picking?.isActive) return

    const view = this._viewTransform(graph)
    if (!view) return
    const { viewport } = this.context
    graph.setViewTransform(view, [viewport.width, viewport.height])
    graph.drawToRenderPass(this.context.renderPass)
  }

  /** The whole simulation space, in space coordinates; lets deck's viewport helpers frame the graph. */
  public getBounds (): [number[], number[]] | null {
    const spaceSize = this._spaceSize()
    return [[0, 0, 0], [spaceSize, spaceSize, 0]]
  }

  public finalizeState (context: LayerContext): void {
    if (this.state?.animationHandle !== undefined) {
      this.context.timeline.detachAnimation(this.state.animationHandle)
    }
    if (this.state) this._releaseGraph()
    super.finalizeState(context)
  }

  /** No deck attributes: cosmos.gl holds every channel and draws them itself. */
  protected _getAttributeManager (): null {
    return null
  }

  /** Adopts the provided graph, or creates a headless one on deck's device when `provided` is `null`. */
  private _attachGraph (provided: Graph | null): void {
    const { device } = this.context
    const graph = provided ?? new Graph(null, this._graphConfig(), Promise.resolve(device))
    this.setState({
      graph,
      providedGraph: provided,
      isReady: false,
      hasLoaded: false,
      loadedPositions: undefined,
      loadedPairs: null,
      idToIndex: null,
      keptLinks: null,
    })

    if (!provided) this.props.onGraphCreated?.(graph)

    graph.ready.then(() => {
      // `this` may be a stale descriptor by now; state is the stable identity
      if (this.state?.graph !== graph) return
      const layer = (this.getCurrentLayer() ?? this) as CosmosGraphLayer<PointDataT, LinkDataT>
      // cosmos records its draws into deck's render pass: that needs deck's device
      if (graph.simulation.device !== layer.context.device) {
        console.error(
          '@cosmos.gl/deck-layers: the provided graph runs on a different device than deck — construct it with the device from deck\'s onDeviceInitialized'
        )
        return
      }
      // Only now may the layer touch the graph's data
      if (layer.state.isIngestPending) {
        layer.state.isIngestPending = false
        layer._load({ pointsChanged: true, linksChanged: true, idsChanged: true, pointStyleChanged: true, linkStyleChanged: true })
      }
      layer.setState({ isReady: true })
    }).catch((error: Error) => {
      console.error('@cosmos.gl/deck-layers: the graph failed to initialize', error)
    })
  }

  /** Destroys a layer-created graph; a provided one is left to the application. */
  private _releaseGraph (): void {
    const { graph, providedGraph } = this.state
    if (graph && !providedGraph) graph.destroy()
    this.state.graph = undefined
  }

  /** The graph's space size — authoritative for a provided graph too. */
  private _spaceSize (): number {
    return this.state?.graph?.config.spaceSize ?? this.props.config?.spaceSize ?? Graph.prototype.config?.spaceSize ?? 4096
  }

  /**
   * The config for a layer-created graph: the prop without the keys deck owns,
   * and the pixel ratio deck's canvas draws at, so cosmos sizes pixels alike.
   */
  private _graphConfig (): GraphConfig {
    const config: Partial<Record<keyof GraphConfig, unknown>> = { ...this.props.config }
    for (const key of DECK_OWNED_CONFIG_KEYS) delete config[key]
    config.pixelRatio = this._pixelRatio()
    return config as GraphConfig
  }

  /** deck's device pixels per CSS pixel, as its canvas context reports them. */
  private _pixelRatio (): number {
    const canvasContext = this.context.device.canvasContext as { cssToDeviceRatio?: () => number } | null
    const ratio = canvasContext?.cssToDeviceRatio?.()
    if (ratio && Number.isFinite(ratio)) return ratio
    return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  }

  /**
   * cosmos's view for deck's current viewport: a uniform scale `k` (pixels per
   * space unit) and a translation, per `setViewTransform`'s space → screen
   * formula, inverted. Three anchors through deck's projection — the space
   * origin, its x axis, its y axis — give the scale and tell whether the view
   * is one cosmos can draw: unrotated, unpitched, y up.
   */
  private _viewTransform (graph: Graph): { k: number; x: number; y: number } | null {
    const { viewport } = this.context
    const spaceSize = graph.config.spaceSize
    const modelMatrix = this.props.modelMatrix
    const toPixel = (sx: number, sy: number): [number, number] => {
      // Space → common (through modelMatrix, column-major, z = 0) → world → pixel.
      // On a map, common is Web Mercator and world is lng/lat; elsewhere both are
      // common, and unprojectPosition is the identity
      const cx = modelMatrix ? (modelMatrix[0] as number) * sx + (modelMatrix[4] as number) * sy + (modelMatrix[12] as number) : sx
      const cy = modelMatrix ? (modelMatrix[1] as number) * sx + (modelMatrix[5] as number) * sy + (modelMatrix[13] as number) : sy
      const world = viewport.unprojectPosition([cx, cy, 0])
      const pixel = viewport.project(world)
      return [pixel[0] as number, pixel[1] as number]
    }
    const [originX, originY] = toPixel(0, 0)
    const [eastX, eastY] = toPixel(spaceSize, 0)
    const [northX, northY] = toPixel(0, spaceSize)
    const k = (eastX - originX) / spaceSize
    const tolerance = 1e-3 * Math.max(1, Math.abs(eastX - originX))
    const rotated = Math.abs(eastY - originY) > tolerance || Math.abs(northX - originX) > tolerance
    const yDown = northY > originY
    if (rotated || yDown || !(k > 0)) {
      if (!this.state.viewWarned) {
        this.state.viewWarned = true
        console.warn(
          '@cosmos.gl/deck-layers: cosmos.gl draws under a flat, north-up, y-up view only — use OrthographicView({ flipY: false }) or a map at pitch 0 and bearing 0. The graph is not drawn.'
        )
      }
      return null
    }
    this.state.viewWarned = false
    return {
      k,
      x: originX - (k * (viewport.width - spaceSize)) / 2,
      y: originY - k * (spaceSize + (viewport.height - spaceSize) / 2),
    }
  }

  private _onTimelineTick (time: number): void {
    const { graph, isReady } = this.state ?? {}
    if (!graph || !isReady || !graph.isSimulationRunning) return
    // One step per frame per graph, however many layers draw it
    if (steppedAt.get(graph) !== time) {
      steppedAt.set(graph, time)
      graph.step()
    }
    // Repaint the frame this step just computed; when the simulation settles,
    // the flag stops being set and deck goes idle on its own
    ;(this.getCurrentLayer() ?? this).setNeedsRedraw()
  }

  /**
   * Load mode: puts the layer's `points`, `links` and styles into the graph.
   * Each channel is sent only when its own input changed — a restyle leaves the
   * layout alone, a changed id map re-resolves array links without touching the
   * positions.
   */
  private _load (changes: {
    pointsChanged: boolean;
    linksChanged: boolean;
    idsChanged: boolean;
    pointStyleChanged: boolean;
    linkStyleChanged: boolean;
  }): void {
    const graph = this.state.graph
    if (!graph) return
    const { points, links, getPointId, getPointPosition } = this.props
    if (!points) return
    const firstLoad = !this.state.hasLoaded
    const spaceSize = this._spaceSize()

    // Unseeded points land in the middle half of the space, clear of the walls. They
    // are drawn from the graph's own RNG, so a `randomSeed` reproduces the layout
    const randomCoordinate = (): number => spaceSize * graph.simulation.store.getRandomFloat(0.25, 0.75)

    let pointCount: number
    let pointObjects: readonly PointDataT[] | null = null
    let pointAttributes: CosmosPointAttributes | undefined
    let positions: Float32Array | null = null // to load; null leaves the graph's
    let loadedPositions = this.state.loadedPositions
    let idToIndex = this.state.idToIndex ?? null

    if (Array.isArray(points)) {
      const pointArray = points as readonly PointDataT[]
      pointCount = pointArray.length
      pointObjects = pointArray
      // Object points carry positions and ids together: a change reloads both
      if (firstLoad || changes.pointsChanged) {
        positions = new Float32Array(pointCount * 2)
        idToIndex = getPointId ? new Map() : null
        for (let i = 0; i < pointCount; i += 1) {
          const point = pointArray[i] as PointDataT
          const info: AccessorContext<PointDataT> = { index: i, data: pointArray, target: [] }
          const position = getPointPosition ? resolveAccessor(getPointPosition, point, info) : null
          positions[i * 2] = position ? position[0] : randomCoordinate()
          positions[i * 2 + 1] = position ? position[1] : randomCoordinate()
          if (idToIndex && getPointId) idToIndex.set(resolveAccessor(getPointId, point, info), i)
        }
        loadedPositions = pointArray
      } else if (changes.idsChanged) {
        idToIndex = getPointId ? new Map() : null
        if (idToIndex && getPointId) {
          for (let i = 0; i < pointCount; i += 1) {
            const info: AccessorContext<PointDataT> = { index: i, data: pointArray, target: [] }
            idToIndex.set(resolveAccessor(getPointId, pointArray[i] as PointDataT, info), i)
          }
        }
      }
    } else {
      const binaryPoints = points as { length: number; initialPositions?: Float32Array; attributes?: CosmosPointAttributes }
      pointCount = binaryPoints.length
      pointAttributes = binaryPoints.attributes
      idToIndex = null
      // Positions reload when their input changed: another `initialPositions`
      // array, a seed the layer must draw again for a new count, or a first load
      const positionsInput: unknown = binaryPoints.initialPositions ?? SEEDED
      if (firstLoad || positionsInput !== this.state.loadedPositions || pointCount !== this.state.pointCount) {
        if (binaryPoints.initialPositions) {
          positions = binaryPoints.initialPositions
        } else {
          positions = new Float32Array(pointCount * 2)
          for (let i = 0; i < positions.length; i += 1) positions[i] = randomCoordinate()
        }
        loadedPositions = positionsInput
      }
    }

    let pairs: Float32Array | null = null // to load; null leaves the graph's
    let linkCount = this.state.linkCount
    let keptLinks: readonly LinkDataT[] | null = this.state.keptLinks
    let linkAttributes: CosmosLinkAttributes | undefined
    if (links instanceof Float32Array || (links && !Array.isArray(links) && 'pairs' in links)) {
      const pairArray = links instanceof Float32Array ? links : links.pairs
      linkAttributes = links instanceof Float32Array ? undefined : links.attributes
      keptLinks = null
      linkCount = pairArray.length / 2
      if (firstLoad || pairArray !== this.state.loadedPairs) pairs = pairArray
    } else if (Array.isArray(links)) {
      // Array links resolve against the loaded points, so they reload with them
      if (firstLoad || changes.linksChanged || positions) {
        const linkObjects = links as readonly LinkDataT[]
        const { getLinkSource, getLinkTarget } = this.props
        // An endpoint is a point index, or a point id when the id map exists;
        // anything that does not name a point drops the whole link
        const resolveEndpoint = (endpoint: string | number): number | undefined => {
          const index = idToIndex ? idToIndex.get(endpoint) : endpoint
          return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < pointCount
            ? index
            : undefined
        }
        const kept: LinkDataT[] = []
        const keptIndices: number[] = []
        for (let i = 0; i < linkObjects.length; i += 1) {
          const link = linkObjects[i] as LinkDataT
          const info: AccessorContext<LinkDataT> = { index: i, data: linkObjects, target: [] }
          const source = resolveEndpoint(resolveAccessor(getLinkSource, link, info))
          const target = resolveEndpoint(resolveAccessor(getLinkTarget, link, info))
          if (source === undefined || target === undefined) continue
          kept.push(link)
          keptIndices.push(source, target)
        }
        const dropped = linkObjects.length - kept.length
        if (dropped > 0) {
          const hint = idToIndex ? 'getLinkSource / getLinkTarget against getPointId' : 'getLinkSource / getLinkTarget'
          console.warn(
            `@cosmos.gl/deck-layers: dropped ${dropped} of ${linkObjects.length} links whose source or target is not a point — check ${hint}`
          )
        }
        pairs = Float32Array.from(keptIndices)
        keptLinks = kept
        linkCount = kept.length
      }
    } else {
      keptLinks = null
      linkCount = 0
      if (firstLoad || this.state.loadedPairs !== NO_LINKS) pairs = NO_LINKS
    }

    // Positions are space coordinates by contract: not rescaled unless the config asks
    if (positions) graph.setPointPositions(positions, this.props.config?.rescalePositions === undefined ? true : undefined)
    if (pairs) graph.setLinks(pairs)
    // Styles: deck accessors and attributes, as cosmos's arrays. They follow a
    // reload (the count may have changed) and their own accessors
    const { getPointColor, getPointSize, getLinkColor, getLinkWidth } = this.props
    if (positions || changes.pointStyleChanged) {
      graph.setPointColors(toColorArray(pointCount, getPointColor, pointObjects, pointAttributes?.getPointColor))
      graph.setPointSizes(toValueArray(pointCount, getPointSize, pointObjects, pointAttributes?.getPointSize))
    }
    if (pairs || changes.linkStyleChanged) {
      graph.setLinkColors(toColorArray(linkCount, getLinkColor, keptLinks, linkAttributes?.getLinkColor))
      graph.setLinkWidths(toValueArray(linkCount, getLinkWidth, keptLinks, linkAttributes?.getLinkWidth))
    }
    // A headless graph applies at once: no transition, and the simulation keeps its alpha
    graph.render()

    // A new id map with nothing reloaded still changes how ids reach indices
    const idsRemapped = idToIndex !== this.state.idToIndex
    this.setState({
      hasLoaded: true,
      pointCount,
      linkCount,
      keptLinks,
      loadedPositions,
      loadedPairs: pairs ?? this.state.loadedPairs,
      idToIndex,
    })

    // After the graph holds the data, so what the callback sends lines up with it.
    // A throw is the app's error, not the layer's: it goes to deck's onError and leaves
    // the load, and the layer's readiness after a first load, intact.
    if (positions || pairs || idsRemapped) {
      try {
        this.props.onGraphDataLoaded?.({
          graph,
          pointsLoaded: Boolean(positions),
          linksLoaded: Boolean(pairs),
          pointIndexById: idToIndex,
          links: Array.isArray(links) ? keptLinks : null,
        })
      } catch (error) {
        this.raiseError(error as Error, 'onGraphDataLoaded')
      }
    }
  }
}
