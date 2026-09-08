import { CompositeLayer } from '@deck.gl/core'
import type {
  Accessor,
  AccessorContext,
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
 * Points input: an array to run accessors over (picking returns the original
 * objects), or the cosmos-native binary form — a point count plus optional
 * `[x0, y0, x1, y1, …]` initial positions. Points without given positions are
 * seeded randomly inside the simulation space.
 */
export type CosmosGraphPoints<PointDataT> = readonly PointDataT[] | {
  length: number;
  initialPositions?: Float32Array;
  /** Optional binary styling channels, keyed by accessor name (`getPointColor`, `getPointSize`). */
  attributes?: Record<string, unknown>;
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
  /** One entry per point — an array of your objects, or `{ length, initialPositions? }`. */
  points: CosmosGraphPoints<PointDataT>;
  /** One entry per link — an array of your objects, or a flat point-index pair array. */
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
  /** Simulation configuration, passed through to `GraphSimulation` (forces, spaceSize, callbacks). */
  simulationConfig?: GraphSimulationConfig;
  /**
   * Called once with the layer-owned `GraphSimulation` — the escape hatch for
   * advanced control (pause, pinning, sparse position writes).
   */
  onSimulationCreated?: ((simulation: GraphSimulation) => void) | null;
}

const defaultProps: DefaultProps<CosmosGraphLayerProps> = {
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
 * The batteries-included cosmos.gl graph layer: give it points and links, and
 * it owns the rest. The layer creates a `GraphSimulation` on deck's device,
 * ingests the data, advances the simulation once per animation frame from
 * deck's shared timeline while it runs (deck goes idle when it settles — no
 * `_animate` required), renders through `CosmosLinksLayer` + `CosmosPointsLayer`
 * (positions stay GPU-resident), and destroys the simulation when the layer is
 * removed. Picking reports `elementType: 'point' | 'link'` alongside the index
 * and, for array data, the original object.
 */
export class CosmosGraphLayer<PointDataT = unknown, LinkDataT = unknown> extends CompositeLayer<
  Required<CosmosGraphLayerOwnProps<PointDataT, LinkDataT>>
> {
  public static layerName = 'CosmosGraphLayer'
  public static defaultProps = defaultProps

  declare public state: {
    simulation?: GraphSimulation;
    isReady: boolean;
    pointCount: number;
    pointsData: readonly PointDataT[] | { length: number; attributes?: Record<string, unknown> };
    linksData: readonly LinkDataT[] | { length: number; attributes: Record<string, unknown> } | null;
    /** Array links only: the resolved `[source, target]` point-index pairs, one per entry of `linksData`. */
    linkIndices: Float32Array | null;
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

    const simulation = new GraphSimulation(this.props.simulationConfig, Promise.resolve(device))
    this.state = {
      simulation,
      isReady: false,
      pointCount: 0,
      pointsData: { length: 0 },
      linksData: null,
      linkIndices: null,
      draggedPointIndex: null,
      // Step the simulation exactly once per animation frame, independent of
      // draw passes (draw runs per viewport and again while picking)
      animationHandle: timeline.attachAnimation({ setTime: () => this._onTimelineTick() }),
    }

    this.props.onSimulationCreated?.(simulation)

    simulation.ready.then(() => {
      // `this` may be a stale descriptor by now; state is the stable identity
      if (this.state?.simulation !== simulation) return
      const layer = this.getCurrentLayer() ?? this
      layer.setState({ isReady: true })
    }).catch((error: Error) => {
      console.error('@cosmos.gl/deck-layers: simulation failed to initialize', error)
    })
  }

  public updateState (params: UpdateParameters<this>): void {
    super.updateState(params)
    const { props, oldProps, changeFlags } = params
    const simulation = this.state.simulation
    if (!simulation) return

    if (changeFlags.propsChanged && props.simulationConfig !== oldProps.simulationConfig) {
      simulation.setConfig(props.simulationConfig)
    }
    // Link endpoints are resolved at ingest, so a change to the id map or to
    // an endpoint accessor re-ingests like a data change
    const triggers = typeof changeFlags.updateTriggersChanged === 'object'
      ? changeFlags.updateTriggersChanged as CosmosUpdateTriggers
      : undefined
    const dataChanged =
      props.points !== oldProps.points ||
      props.links !== oldProps.links ||
      Boolean(
        triggers?.getPointPosition || triggers?.getPointId || triggers?.getLinkSource || triggers?.getLinkTarget
      )
    if (dataChanged) {
      this._updateSimulationData()
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
    const spaceSize = this.props.simulationConfig?.spaceSize ?? defaultConfigValues.spaceSize
    return [[0, 0, 0], [spaceSize, spaceSize, 0]]
  }

  public finalizeState (context: LayerContext): void {
    if (this.state?.animationHandle !== undefined) {
      this.context.timeline.detachAnimation(this.state.animationHandle)
    }
    this.state?.simulation?.destroy()
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

  private _onTimelineTick (): void {
    const { simulation, isReady } = this.state ?? {}
    if (!simulation || !isReady || !simulation.isSimulationRunning) return
    simulation.step()
    // Repaint the frame this step just computed; when the simulation settles,
    // the flag stops being set and deck goes idle on its own
    const layer = this.getCurrentLayer() ?? this
    layer.setNeedsRedraw()
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
    const spaceSize = this.props.simulationConfig?.spaceSize ?? defaultConfigValues.spaceSize

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
      const binaryPoints = points as { length: number; initialPositions?: Float32Array; attributes?: Record<string, unknown> }
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
      // The cosmos pair array feeds deck as two interleaved binary attributes
      linksData = {
        length: links.length / 2,
        attributes: {
          getLinkSource: { value: links, size: 1, stride: 8 },
          getLinkTarget: { value: links, size: 1, offset: 4, stride: 8 },
        },
      }
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

    this.setState({ pointCount, pointsData, linksData, linkIndices })
  }
}
