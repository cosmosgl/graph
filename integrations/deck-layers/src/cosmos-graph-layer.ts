import { CompositeLayer } from '@deck.gl/core'
import type {
  Accessor,
  AccessorContext,
  BinaryAttribute,
  Color,
  DefaultProps,
  GetPickingInfoParams,
  Layer,
  LayerContext,
  LayerProps,
  PickingInfo,
  Unit,
  UpdateParameters,
} from '@deck.gl/core'
import { GraphSimulation, defaultConfigValues } from '@cosmos.gl/graph'
import type { GraphSimulationConfig } from '@cosmos.gl/graph'

import { BLEND_PARAMETERS } from './blend-parameters'
import { CosmosPointsLayer } from './cosmos-points-layer'
import { CosmosLinksLayer } from './cosmos-links-layer'

/**
 * Binary styling channels for binary points, keyed by the accessor each one
 * replaces: deck uploads the typed array as the instanced attribute instead of
 * calling the accessor per point. Colors are RGBA bytes (0..255), 4 per point;
 * sizes are one diameter per point, in `pointSizeUnits`.
 */
export type CosmosPointAttributes = {
  getPointColor?: BinaryAttribute;
  getPointSize?: BinaryAttribute;
}

/**
 * Points input: an array to run accessors over (picking returns the original
 * objects), or the cosmos-native binary form — a point count plus optional
 * `[x0, y0, x1, y1, …]` initial positions and binary styling channels. Points
 * without given positions are seeded randomly inside the simulation space.
 */
export type CosmosGraphPoints<PointDataT> = readonly PointDataT[] | {
  length: number;
  initialPositions?: Float32Array;
  attributes?: CosmosPointAttributes;
}

/**
 * Links input: an array to run accessors over, or the cosmos-native
 * `[source0, target0, source1, target1, …]` array of point indices.
 * An array link whose source or target does not resolve to a point is dropped
 * from both the simulation and the rendering, with one warning per data change.
 */
export type CosmosGraphLinks<LinkDataT> = readonly LinkDataT[] | Float32Array

/** Picking info from a CosmosGraphLayer: which kind of element was hit. */
export type CosmosGraphPickingInfo = PickingInfo & {
  elementType?: 'point' | 'link';
}

export type CosmosGraphLayerProps<PointDataT = unknown, LinkDataT = unknown> =
  CosmosGraphLayerOwnProps<PointDataT, LinkDataT> & LayerProps

type CosmosGraphLayerOwnProps<PointDataT, LinkDataT> = {
  /**
   * One entry per point — an array of your objects, or `{ length, initialPositions?, attributes? }`.
   * The layer loads them, with `links`, into the simulation. Omit it to draw the data the
   * simulation already holds instead: the layer then writes nothing into the simulation and
   * follows its point count and links — the mode for an application-loaded `simulation`.
   */
  points?: CosmosGraphPoints<PointDataT> | null;
  /** One entry per link — an array of your objects, or a flat point-index pair array. Ignored without `points`. */
  links?: CosmosGraphLinks<LinkDataT> | null;
  /**
   * Stable point id accessor. When provided (with array points), link
   * accessors may return ids instead of point indices.
   */
  getPointId?: Accessor<PointDataT, string | number> | null;
  /** Initial `[x, y]` position accessor for array points; points it leaves undefined are seeded randomly. */
  getPointPosition?: Accessor<PointDataT, readonly [number, number] | null | undefined> | null;
  /**
   * Point diameter accessor, in `pointSizeUnits`; `0` hides the point.
   * @default 4
   */
  getPointSize?: Accessor<PointDataT, number>;
  /**
   * Point RGBA color accessor, channels in 0..255.
   * @default [74, 92, 191, 230]
   */
  getPointColor?: Accessor<PointDataT, Color>;
  /**
   * The units of the point diameter.
   * @default 'pixels'
   */
  pointSizeUnits?: Unit;
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
   * Link width accessor, in `linkWidthUnits`.
   * @default 1
   */
  getLinkWidth?: Accessor<LinkDataT, number>;
  /**
   * The units of the link width.
   * @default 'pixels'
   */
  linkWidthUnits?: Unit;
  /**
   * Lets pointer drags grab a point: pinned on drag start, moved with the
   * pointer, released per `unpinOnDragEnd`. View panning is suppressed while
   * a point is grabbed.
   * @default false
   */
  enablePointDrag?: boolean;
  /**
   * Simulation alpha to restart with when a drag starts, so the graph
   * responds to the moving point; `null` leaves the simulation untouched.
   * @default 0.1
   */
  dragReheatAlpha?: number | null;
  /**
   * Release the point on drag end; `false` keeps it pinned where dropped.
   * @default true
   */
  unpinOnDragEnd?: boolean;
  /** Called when a point drag starts. */
  onPointDragStart?: ((info: CosmosGraphPickingInfo) => void) | null;
  /** Called for every pointer move while a point is dragged. */
  onPointDrag?: ((info: CosmosGraphPickingInfo) => void) | null;
  /** Called when a point drag ends. */
  onPointDragEnd?: ((info: CosmosGraphPickingInfo) => void) | null;
  /**
   * An application-owned `GraphSimulation` to render instead of creating one.
   * It must run on deck's device — construct it with the device from deck's
   * `onDeviceInitialized`. The layer steps it while it runs (`pause()` it to
   * take over stepping, then `deck.redraw()` after each manual `step()`) and
   * renders it; it never configures or destroys it — `simulationConfig` and
   * `onSimulationCreated` apply only to a layer-created simulation, and
   * teardown is the application's, before `deck.finalize()`.
   *
   * `points` decides who loads the data. Given, the layer loads `points` and
   * `links` into the simulation once the device check has passed, over whatever
   * it held. Omitted, the layer draws the simulation's own data and follows its
   * changes. Several layers may draw one simulation — it steps once per frame
   * however many draw it — as long as at most one of them loads data.
   */
  simulation?: GraphSimulation | null;
  /**
   * Simulation configuration, passed through to the layer-created
   * `GraphSimulation` (forces, spaceSize, callbacks). Ignored when
   * `simulation` is provided.
   */
  simulationConfig?: GraphSimulationConfig;
  /**
   * Called once with the layer-created `GraphSimulation` — the escape hatch for
   * advanced control (pause, pinning, sparse position writes). Not called for
   * a provided `simulation`.
   */
  onSimulationCreated?: ((simulation: GraphSimulation) => void) | null;
}

const defaultProps: DefaultProps<CosmosGraphLayerProps> = {
  points: { type: 'object', value: null, optional: true },
  links: null,
  getPointId: { type: 'accessor', value: null },
  getPointPosition: { type: 'accessor', value: null },
  getPointSize: { type: 'accessor', value: 4 },
  getPointColor: { type: 'accessor', value: [74, 92, 191, 230] },
  pointSizeUnits: 'pixels',
  getLinkSource: { type: 'accessor', value: (l: unknown) => (l as { source: number }).source },
  getLinkTarget: { type: 'accessor', value: (l: unknown) => (l as { target: number }).target },
  getLinkColor: { type: 'accessor', value: [94, 115, 194, 64] },
  getLinkWidth: { type: 'accessor', value: 1 },
  linkWidthUnits: 'pixels',
  enablePointDrag: false,
  dragReheatAlpha: 0.1,
  unpinOnDragEnd: true,
  onPointDragStart: { type: 'function', value: null, optional: true },
  onPointDrag: { type: 'function', value: null, optional: true },
  onPointDragEnd: { type: 'function', value: null, optional: true },
  simulation: { type: 'object', value: null, optional: true },
  simulationConfig: { type: 'object', value: {}, compare: 2 },
  onSimulationCreated: { type: 'function', value: null, optional: true },
  // getSubLayerProps forwards `parameters` into every sublayer, so the
  // composite must carry the same pipeline-state default the primitives do
  parameters: { type: 'object', value: BLEND_PARAMETERS, optional: true, compare: 2 },
}

/** The slice of a deck gesture event the drag handlers need. */
type DragGestureEvent = {
  stopImmediatePropagation?: () => void;
}

/** The update-trigger keys the composite forwards to its sublayers. */
type CosmosUpdateTriggers = {
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
 * When each simulation last stepped, by timeline time: layers drawing the same
 * simulation share one step per frame instead of each taking their own.
 */
const steppedAt = new WeakMap<GraphSimulation, number>()

/** The binary channels of the links sublayer: the endpoints, read straight from the cosmos pair array. */
type CosmosLinkAttributes = {
  getLinkSource: BinaryAttribute;
  getLinkTarget: BinaryAttribute;
}

/** The cosmos pair array as deck binary link data: two interleaved attributes, no copy. */
const binaryLinksData = (links: Float32Array): { length: number; attributes: CosmosLinkAttributes } => ({
  length: links.length / 2,
  attributes: {
    getLinkSource: { value: links, size: 1, stride: 8 },
    getLinkTarget: { value: links, size: 1, offset: 4, stride: 8 },
  },
})

/**
 * The cosmos.gl graph layer: give it points and links, and it handles the
 * rest. The layer creates a `GraphSimulation` on deck's device (or renders the
 * application's, via `simulation`), loads the data — or, without `points`,
 * follows the data the simulation holds — advances the simulation once per
 * animation frame from deck's shared timeline while it runs (deck goes idle
 * when it settles — no `_animate` required), renders through its internal
 * links and points sublayers (positions stay GPU-resident), and destroys a
 * simulation it created when the layer is removed. Picking reports
 * `elementType: 'point' | 'link'` alongside the index and, for array data, the
 * original object.
 */
export class CosmosGraphLayer<PointDataT = unknown, LinkDataT = unknown> extends CompositeLayer<
  Required<CosmosGraphLayerOwnProps<PointDataT, LinkDataT>>
> {
  public static layerName = 'CosmosGraphLayer'
  public static defaultProps = defaultProps

  declare public state: {
    simulation?: GraphSimulation;
    /** The `simulation` prop this state was built from; `null` when the layer created its own. */
    providedSimulation: GraphSimulation | null;
    isReady: boolean;
    /** `points` changed before the simulation was ready: load them once it is. */
    isIngestPending: boolean;
    pointCount: number;
    pointsData: readonly PointDataT[] | { length: number; attributes?: CosmosPointAttributes };
    linksData: readonly LinkDataT[] | { length: number; attributes: CosmosLinkAttributes } | null;
    /** Array links only: the resolved `[source, target]` point-index pairs, one per entry of `linksData`. */
    linkIndices: Float32Array | null;
    /** Without `points`: the simulation's links array the render data was built from. */
    followedLinks?: Float32Array | null;
    draggedPointIndex: number | null;
    animationHandle?: number;
  }

  public get isLoaded (): boolean {
    return super.isLoaded && Boolean(this.state?.isReady)
  }

  public initializeState (): void {
    const { device, timeline } = this.context
    if (device.type !== 'webgl') {
      throw new Error(
        `@cosmos.gl/deck-layers requires a WebGL 2 device — the cosmos.gl simulation is WebGL-only, got '${device.type}'`
      )
    }

    this.state = {
      providedSimulation: null,
      isReady: false,
      isIngestPending: false,
      pointCount: 0,
      pointsData: { length: 0 },
      linksData: null,
      linkIndices: null,
      draggedPointIndex: null,
      // Step the simulation exactly once per animation frame, independent of
      // draw passes (draw runs per viewport and again while picking)
      animationHandle: timeline.attachAnimation({ setTime: (time) => this._onTimelineTick(time) }),
    }
    this._attachSimulation(this.props.simulation ?? null)
  }

  public updateState (params: UpdateParameters<this>): void {
    super.updateState(params)
    const { props, oldProps, changeFlags } = params
    // Swapping simulations loads the current data into the new one, or follows it
    const providedSimulation = props.simulation ?? null
    const simulationSwapped = providedSimulation !== this.state.providedSimulation
    if (simulationSwapped) {
      this._releaseSimulation()
      this._attachSimulation(providedSimulation)
    }
    const simulation = this.state.simulation
    if (!simulation) return

    if (!providedSimulation && changeFlags.propsChanged && props.simulationConfig !== oldProps.simulationConfig) {
      simulation.setConfig(props.simulationConfig)
    }
    // Link endpoints are resolved at ingest, so a change to the id map or to
    // an endpoint accessor re-ingests like a data change
    const triggers = typeof changeFlags.updateTriggersChanged === 'object'
      ? changeFlags.updateTriggersChanged as CosmosUpdateTriggers
      : undefined
    const dataChanged =
      simulationSwapped ||
      props.points !== oldProps.points ||
      props.links !== oldProps.links ||
      Boolean(
        triggers?.getPointPosition || triggers?.getPointId || triggers?.getLinkSource || triggers?.getLinkTarget
      )
    if (!dataChanged) return

    if (props.points) {
      // The layer's data goes into the simulation — once the device check has passed
      if (this.state.isReady) this._updateSimulationData()
      else this.state.isIngestPending = true
    } else {
      // No data of its own: the layer draws what the simulation holds
      if (props.links) {
        console.warn('@cosmos.gl/deck-layers: `links` is ignored without `points` — load them into the simulation instead')
      }
      this.state.isIngestPending = false
      if (this.state.isReady) this._syncFromSimulation(true)
    }
  }

  public renderLayers (): Layer[] | null {
    const { simulation, isReady, pointCount, pointsData, linksData, linkIndices } = this.state
    if (!simulation || !isReady || pointCount === 0) return null

    const { getPointSize, getPointColor, pointSizeUnits, getLinkColor, getLinkWidth, linkWidthUnits } = this.props
    const triggers: CosmosUpdateTriggers = this.props.updateTriggers ?? {}
    const layers: Layer[] = []

    if (linksData) {
      layers.push(
        new CosmosLinksLayer<LinkDataT>(
          this.getSubLayerProps({
            id: 'links',
            updateTriggers: {
              getLinkSource: triggers.getLinkSource,
              getLinkTarget: triggers.getLinkTarget,
              getLinkColor: triggers.getLinkColor,
              getLinkWidth: triggers.getLinkWidth,
            },
          }),
          {
            data: linksData as CosmosLinksLayer<LinkDataT>['props']['data'],
            graph: simulation,
            getLinkColor,
            getLinkWidth,
            linkWidthUnits,
            // getSubLayerProps does not forward `transitions`
            transitions: this.props.transitions,
          },
          Array.isArray(linksData) && linkIndices
            ? {
              // Array links read the endpoints resolved at ingest, so the
              // rendered links are exactly the simulated ones
              getLinkSource: (_: LinkDataT, { index }: AccessorContext<LinkDataT>): number => linkIndices[index * 2] as number,
              getLinkTarget: (_: LinkDataT, { index }: AccessorContext<LinkDataT>): number => linkIndices[index * 2 + 1] as number,
            }
            : {}
        )
      )
    }

    layers.push(
      new CosmosPointsLayer<PointDataT>(
        this.getSubLayerProps({
          id: 'points',
          updateTriggers: {
            getPointSize: triggers.getPointSize,
            getPointColor: triggers.getPointColor,
          },
        }),
        {
          data: pointsData as CosmosPointsLayer<PointDataT>['props']['data'],
          graph: simulation,
          getPointSize,
          getPointColor,
          pointSizeUnits,
          // getSubLayerProps does not forward `transitions`
          transitions: this.props.transitions,
        }
      )
    )

    return layers
  }

  public onDragStart (info: PickingInfo, event: DragGestureEvent): boolean {
    const { simulation } = this.state
    const { enablePointDrag, dragReheatAlpha } = this.props
    const picked = info as CosmosGraphPickingInfo
    if (!enablePointDrag || !simulation || picked.elementType !== 'point' || info.index < 0) return false

    // A direct field write: per-gesture state must not re-render sublayers
    this.state.draggedPointIndex = info.index
    simulation.setPinnedPoint(info.index, true)
    if (dragReheatAlpha !== null) simulation.start(dragReheatAlpha)
    // A grabbed point must not also pan the view
    event.stopImmediatePropagation?.()
    this.props.onPointDragStart?.(picked)
    return true
  }

  public onDrag (info: PickingInfo, event: DragGestureEvent): boolean {
    const { simulation, draggedPointIndex } = this.state
    if (!simulation || draggedPointIndex === null) return false

    const [x, y] = this._dragCoordinate(info)
    simulation.setPointPosition(draggedPointIndex, x, y)
    event.stopImmediatePropagation?.()
    // Repaint even when the simulation is settled and the ticker is idle
    ;(this.getCurrentLayer() ?? this).setNeedsRedraw()
    this.props.onPointDrag?.(info as CosmosGraphPickingInfo)
    return true
  }

  public onDragEnd (info: PickingInfo, event: DragGestureEvent): boolean {
    const { simulation, draggedPointIndex } = this.state
    if (!simulation || draggedPointIndex === null) return false

    if (this.props.unpinOnDragEnd) simulation.setPinnedPoint(draggedPointIndex, false)
    this.state.draggedPointIndex = null
    event.stopImmediatePropagation?.()
    this.props.onPointDragEnd?.(info as CosmosGraphPickingInfo)
    return true
  }

  public getPickingInfo (params: GetPickingInfoParams): CosmosGraphPickingInfo {
    const info: CosmosGraphPickingInfo = params.info
    if (params.sourceLayer) {
      info.elementType = params.sourceLayer.id.endsWith('-links') ? 'link' : 'point'
    }
    return info
  }

  /** The whole simulation space; lets deck's viewport helpers frame the graph. */
  public getBounds (): [number[], number[]] | null {
    const spaceSize = this._spaceSize()
    return [[0, 0, 0], [spaceSize, spaceSize, 0]]
  }

  public finalizeState (context: LayerContext): void {
    if (this.state?.animationHandle !== undefined) {
      this.context.timeline.detachAnimation(this.state.animationHandle)
    }
    if (this.state) this._releaseSimulation()
    super.finalizeState(context)
  }

  /**
   * Points and links have separate index spaces, so the same picking color
   * exists in both sublayers: highlight only the sublayer that was hovered
   * and clear the other, or hovering point N would also tint link N.
   */
  protected _updateAutoHighlight (info: PickingInfo): void {
    for (const layer of this.getSubLayers()) {
      if (layer.id === info.sourceLayer?.id) {
        layer.updateAutoHighlight(info)
      } else {
        layer.updateAutoHighlight({ ...info, picked: false })
      }
    }
  }

  /** Adopts the provided simulation, or creates one on deck's device when `provided` is `null`. */
  private _attachSimulation (provided: GraphSimulation | null): void {
    const { device } = this.context
    const simulation = provided ?? new GraphSimulation(this.props.simulationConfig, Promise.resolve(device))
    this.setState({ simulation, providedSimulation: provided, isReady: false, draggedPointIndex: null })

    if (!provided) this.props.onSimulationCreated?.(simulation)

    simulation.ready.then(() => {
      // `this` may be a stale descriptor by now; state is the stable identity
      if (this.state?.simulation !== simulation) return
      const layer = (this.getCurrentLayer() ?? this) as CosmosGraphLayer<PointDataT, LinkDataT>
      // Textures from another device cannot be sampled by deck's draws
      if (simulation.device !== layer.context.device) {
        console.error(
          '@cosmos.gl/deck-layers: the provided simulation runs on a different device than deck — construct it with the device from deck\'s onDeviceInitialized'
        )
        return
      }
      // Only now may the layer touch the simulation's data
      if (layer.state.isIngestPending) {
        layer.state.isIngestPending = false
        layer._updateSimulationData()
      } else if (!layer.props.points) {
        layer._syncFromSimulation(true)
      }
      layer.setState({ isReady: true })
    }).catch((error: Error) => {
      console.error('@cosmos.gl/deck-layers: simulation failed to initialize', error)
    })
  }

  /** Destroys a layer-created simulation; a provided one is left to the application. */
  private _releaseSimulation (): void {
    const { simulation, providedSimulation } = this.state
    if (simulation && !providedSimulation) simulation.destroy()
    this.state.simulation = undefined
  }

  /** The simulation's space size — authoritative for a provided simulation too. */
  private _spaceSize (): number {
    return this.state?.simulation?.config.spaceSize ??
      this.props.simulationConfig?.spaceSize ??
      defaultConfigValues.spaceSize
  }

  private _onTimelineTick (time: number): void {
    const { simulation, isReady } = this.state ?? {}
    if (!simulation || !isReady) return
    const layer = (this.getCurrentLayer() ?? this) as CosmosGraphLayer<PointDataT, LinkDataT>
    // Without data of its own, the layer follows what the application loads
    if (!layer.props.points) layer._syncFromSimulation()
    if (!simulation.isSimulationRunning) return
    // One step per frame per simulation, however many layers draw it
    if (steppedAt.get(simulation) !== time) {
      steppedAt.set(simulation, time)
      simulation.step()
    }
    // Repaint the frame this step just computed; when the simulation settles,
    // the flag stops being set and deck goes idle on its own
    layer.setNeedsRedraw()
  }

  /**
   * Without `points`: builds the render data from what the simulation holds —
   * its point count and links — and rebuilds it when either changes. Runs every
   * tick, so it only compares until something differs.
   */
  private _syncFromSimulation (force = false): void {
    const { simulation } = this.state
    if (!simulation) return
    const pointCount = simulation.data.pointsNumber ?? 0
    const links = simulation.data.links ?? null
    if (!force && pointCount === this.state.pointCount && links === this.state.followedLinks) return
    this.setState({
      pointCount,
      pointsData: { length: pointCount },
      linksData: links && links.length > 0 ? binaryLinksData(links) : null,
      linkIndices: null,
      followedLinks: links,
    })
  }

  private _dragCoordinate (info: PickingInfo): [number, number] {
    // info.coordinate is unprojected at the current pointer; it can be absent
    // when the pointer leaves the picked object's viewport
    if (info.coordinate) return [info.coordinate[0] as number, info.coordinate[1] as number]
    const unprojected = this.context.viewport.unproject([info.x, info.y])
    return [unprojected[0] as number, unprojected[1] as number]
  }

  private _updateSimulationData (): void {
    const simulation = this.state.simulation
    if (!simulation) return
    const { points, links, getPointId, getPointPosition } = this.props
    if (!points) return
    const spaceSize = this._spaceSize()

    // Unseeded points land in the middle half of the space, clear of the walls
    const randomCoordinate = (): number => spaceSize * (0.25 + Math.random() * 0.5)

    let pointCount: number
    let positions: Float32Array
    let pointsData: this['state']['pointsData']
    let idToIndex: Map<string | number, number> | null = null

    if (Array.isArray(points)) {
      const pointArray = points as readonly PointDataT[]
      pointCount = pointArray.length
      positions = new Float32Array(pointCount * 2)
      if (getPointId) idToIndex = new Map()
      for (let i = 0; i < pointCount; i += 1) {
        const point = pointArray[i] as PointDataT
        const info: AccessorContext<PointDataT> = { index: i, data: pointArray, target: [] }
        const position = getPointPosition ? resolveAccessor(getPointPosition, point, info) : null
        positions[i * 2] = position ? position[0] : randomCoordinate()
        positions[i * 2 + 1] = position ? position[1] : randomCoordinate()
        if (idToIndex && getPointId) idToIndex.set(resolveAccessor(getPointId, point, info), i)
      }
      pointsData = pointArray
    } else {
      const binaryPoints = points as { length: number; initialPositions?: Float32Array; attributes?: CosmosPointAttributes }
      pointCount = binaryPoints.length
      if (binaryPoints.initialPositions) {
        positions = binaryPoints.initialPositions
      } else {
        positions = new Float32Array(pointCount * 2)
        for (let i = 0; i < positions.length; i += 1) positions[i] = randomCoordinate()
      }
      pointsData = binaryPoints.attributes
        ? { length: pointCount, attributes: binaryPoints.attributes }
        : { length: pointCount }
    }

    let linkArray: Float32Array | null = null
    let linksData: this['state']['linksData'] = null
    let linkIndices: Float32Array | null = null
    if (links instanceof Float32Array) {
      linkArray = links
      linksData = binaryLinksData(links)
    } else if (Array.isArray(links)) {
      const linkObjects = links as readonly LinkDataT[]
      const { getLinkSource, getLinkTarget } = this.props
      // An endpoint is a point index, or a point id when the id map exists;
      // anything that does not name a point drops the whole link from both
      // the simulation and the rendering, so the two never disagree
      const resolveEndpoint = (endpoint: string | number): number | undefined => {
        const index = idToIndex ? idToIndex.get(endpoint) : endpoint
        return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < pointCount
          ? index
          : undefined
      }
      const keptLinks: LinkDataT[] = []
      const keptIndices: number[] = []
      for (let i = 0; i < linkObjects.length; i += 1) {
        const link = linkObjects[i] as LinkDataT
        const info: AccessorContext<LinkDataT> = { index: i, data: linkObjects, target: [] }
        const source = resolveEndpoint(resolveAccessor(getLinkSource, link, info))
        const target = resolveEndpoint(resolveAccessor(getLinkTarget, link, info))
        if (source === undefined || target === undefined) continue
        keptLinks.push(link)
        keptIndices.push(source, target)
      }
      const dropped = linkObjects.length - keptLinks.length
      if (dropped > 0) {
        const hint = idToIndex ? 'getLinkSource / getLinkTarget against getPointId' : 'getLinkSource / getLinkTarget'
        console.warn(
          `@cosmos.gl/deck-layers: dropped ${dropped} of ${linkObjects.length} links whose source or target is not a point — check ${hint}`
        )
      }
      linkArray = Float32Array.from(keptIndices)
      linkIndices = linkArray
      linksData = keptLinks
    }

    simulation.setPointPositions(positions)
    simulation.setLinks(linkArray ?? new Float32Array(0))
    simulation.applyData()

    this.setState({ pointCount, pointsData, linksData, linkIndices, followedLinks: undefined })
  }
}
