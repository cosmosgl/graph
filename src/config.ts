/* eslint-disable @typescript-eslint/naming-convention */
import { D3ZoomEvent } from 'd3-zoom'
import { D3DragEvent } from 'd3-drag'
import {
  defaultPointColor,
  defaultGreyoutPointOpacity,
  defaultGreyoutPointColor,
  defaultPointOpacity,
  defaultPointSize,
  defaultLinkColor,
  defaultGreyoutLinkOpacity,
  defaultLinkOpacity,
  defaultLinkWidth,
  defaultBackgroundColor,
  defaultConfigValues,
} from '@/graph/variables'
import { isPlainObject } from '@/graph/helper'
import { type Hovered } from '@/graph/modules/Store'

export interface GraphConfigInterface {
  /**
   * If set to `false`, the simulation will not run.
   * This property will be applied only on component initialization and it
   * can't be changed using the `setConfig` method.
   * Default value: `true`
   */
  enableSimulation?: boolean;
  /**
   * Canvas background color.
   * Can be either a hex color string (e.g., '#b3b3b3') or an array of RGBA values.
   * Default value: '#222222'
   */
  backgroundColor?: string | [number, number, number, number];
  /**
   * Simulation space size (max 8192).
   * Default value: `8192`
   */
  spaceSize?: number;

  /**
   * The default color to use for points when no point colors are provided,
   * or if the color value in the array is `undefined` or `null`.
   * This can be either a hex color string (e.g., '#b3b3b3') or an array of RGBA values
   * in the format `[red, green, blue, alpha]` where each value is a number between 0 and 255.
   * Default value: '#b3b3b3'
   */
  pointDefaultColor?: string | [number, number, number, number];

  /** @deprecated Use `pointDefaultColor` instead */
  pointColor?: string | [number, number, number, number];

  /**
   * The color to use for points when they are greyed out (when selection is active).
   * This can be either a hex color string (e.g., '#b3b3b3') or an array of RGBA values
   * in the format `[red, green, blue, alpha]` where each value is a number between 0 and 255.
   *
   * If not provided, the color will be the same as the point's original color,
   * but darkened or lightened depending on the background color.
   *
   * If `pointGreyoutOpacity` is also defined, it will override the alpha/opacity component
   * of this color.
   *
   * Default value: `undefined`
   */
  pointGreyoutColor?: string | [number, number, number, number];

  /**
   * Opacity value for points when they are greyed out (when selection is active).
   * Values range from 0 (completely transparent) to 1 (fully opaque).
   *
   * If defined, this value will override the alpha/opacity component of `pointGreyoutColor`.
   *
   * Default value: `undefined`
   */
  pointGreyoutOpacity?: number;

  /**
   * The default size value to use for points when no point sizes are provided or
   * if the size value in the array is `undefined` or `null`.
   * Default value: `4`
  */
  pointDefaultSize?: number;

  /** @deprecated Use `pointDefaultSize` instead */
  pointSize?: number;

  /**
   * Universal opacity value applied to all points.
   * This value multiplies with individual point alpha values (if set via setPointColors).
   * Useful for dynamically controlling opacity of all points without updating individual RGBA arrays.
   * Default value: `1.0`
   */
  pointOpacity?: number;

  /**
   * Scale factor for the point size.
   * Default value: `1`
   */
  pointSizeScale?: number;

  /**
   * Cursor style to use when hovering over a point
   * Default value: `auto`
   */
  hoveredPointCursor?: string;

  /**
   * Cursor style to use when hovering over a link
   * Default value: `auto`
   */
  hoveredLinkCursor?: string;

  /**
   * Turns ring rendering around a point on hover on / off
   * Default value: `false`
   */
  renderHoveredPointRing?: boolean;

  /**
   * Hovered point ring color hex value.
   * Can be either a hex color string (e.g., '#b3b3b3') or an array of RGBA values.
   * Default value: `white`
   */
  hoveredPointRingColor?: string | [number, number, number, number];

  /**
   * Focused point ring color hex value.
   * Can be either a hex color string (e.g., '#b3b3b3') or an array of RGBA values.
   * Default value: `white`
   */
  focusedPointRingColor?: string | [number, number, number, number];

  /**
   * Set focus on a point by index.  A ring will be highlighted around the focused point.
   * When set to `undefined`, no point is focused.
   * Default value: `undefined`
   */
  focusedPointIndex?: number;

  /**
   * Turns link rendering on / off.
   * Default value: `true`
   */
  renderLinks?: boolean;

  /**
   * The default color to use for links when no link colors are provided,
   * or if the color value in the array is `undefined` or `null`.
   * This can be either a hex color string (e.g., '#666666') or an array of RGBA values
   * in the format `[red, green, blue, alpha]` where each value is a number between 0 and 255.
   * Default value: '#666666'
   */
  linkDefaultColor?: string | [number, number, number, number];

  /** @deprecated Use `linkDefaultColor` instead */
  linkColor?: string | [number, number, number, number];

  /**
   * Universal opacity value applied to all links.
   * This value multiplies with individual link alpha values (if set via setLinkColors).
   * Useful for dynamically controlling opacity of all links without updating individual RGBA arrays.
   * Default value: `1.0`
   */
  linkOpacity?: number;

  /**
   * Greyed out link opacity value when the selection is active.
   * Default value: `0.1`
  */
  linkGreyoutOpacity?: number;
  /**
   * The default width value to use for links when no link widths are provided or if the width value in the array is `undefined` or `null`.
   * Default value: `1`
  */
  linkDefaultWidth?: number;

  /** @deprecated Use `linkDefaultWidth` instead */
  linkWidth?: number;
  /**
   * The color to use for links when they are hovered.
   * This can be either a hex color string (e.g., '#ff3333') or an array of RGBA values
   * in the format `[red, green, blue, alpha]` where each value is a number between 0 and 255.
   * Default value: `undefined`
   */
  hoveredLinkColor?: string | [number, number, number, number];
  /**
   * Number of pixels to add to the link width when hovered.
   * The hovered width is calculated as: originalWidth + hoveredLinkWidthIncrease
   * Default value: `5`
   */
  hoveredLinkWidthIncrease?: number;
  /**
   * Scale factor for the link width.
   * Default value: `1`
   */
  linkWidthScale?: number;
  /**
   * Increase or decrease the size of the links when zooming in or out.
   * Default value: `false`
   */
  scaleLinksOnZoom?: boolean;
  /**
   * If set to true, links are rendered as curved lines.
   * Otherwise as straight lines.
   * Default value: `false`
   */
  curvedLinks?: boolean;
  /**
   * Number of segments in a curved line.
   * Default value: `19`.
   */
  curvedLinkSegments?: number;
  /**
   * Weight affects the shape of the curve.
   * Default value: `0.8`.
   */
  curvedLinkWeight?: number;
  /**
   * Defines the position of the control point of the curve on the normal from the centre of the line.
   * If set to 1 then the control point is at a distance equal to the length of the line.
   * Default value: `0.5`
   */
  curvedLinkControlPointDistance?: number;
  /**
   * The default link arrow value that controls whether or not to display link arrows.
   * Default value: `false`
   */
  linkDefaultArrows?: boolean;

  /** @deprecated Use `linkDefaultArrows` instead */
  linkArrows?: boolean;
  /**
   * Scale factor for the link arrows size.
   * Default value: `1`
   */
  linkArrowsSizeScale?: number;
  /**
   * The range defines the minimum and maximum link visibility distance in pixels.
   * The link will be fully opaque when its length is less than the first number in the array,
   * and will have `linkVisibilityMinTransparency` transparency when its length is greater than
   * the second number in the array.
   * This distance is defined in screen space coordinates and will change as you zoom in and out
   * (e.g. links become longer when you zoom in, and shorter when you zoom out).
   * Default value: `[50, 150]`
   */
  linkVisibilityDistanceRange?: number[];
  /**
   * The transparency value that the link will have when its length reaches
   * the maximum link distance value from `linkVisibilityDistanceRange`.
   * Default value: `0.25`
   */
  linkVisibilityMinTransparency?: number;
  /**
   * Use the classic quadtree algorithm for the Many-Body force.
   * This property will be applied only on component initialization and it
   * can't be changed using the `setConfig` method.
   * Default value: `false`
   */
  useClassicQuadtree?: boolean;

  /**
   * Decay coefficient. Use smaller values if you want the simulation to "cool down" slower.
   * Default value: `5000`
   */
  simulationDecay?: number;
    /**
   * Gravity force coefficient.
   * Default value: `0.25`
   */
  simulationGravity?: number;
  /**
   * Centering to center mass force coefficient.
   * Default value: `0`
   */
  simulationCenter?: number;
  /**
   * Repulsion force coefficient.
   * Default value: `1.0`
   */
  simulationRepulsion?: number;
  /**
   * Decreases / increases the detalization of the Many-Body force calculations.
   * When `useClassicQuadtree` is set to `true`, this property corresponds to the Barnes–Hut approximation criterion.
   * Default value: `1.15`
   */
  simulationRepulsionTheta?: number;
  /**
   * Barnes–Hut approximation depth.
   * Can only be used when `useClassicQuadtree` is set `true`.
   * Default value: `12`
   */
  simulationRepulsionQuadtreeLevels?: number;
  /**
   * Link spring force coefficient.
   * Default value: `1`
   */
  simulationLinkSpring?: number;
  /**
   * Minimum link distance.
   * Default value: `10`
   */
  simulationLinkDistance?: number;
  /**
   * Range of random link distance values.
   * Default value: `[1, 1.2]`
   */
  simulationLinkDistRandomVariationRange?: number[];
  /**
   * Repulsion coefficient from mouse position.
   * The repulsion force is activated by pressing the right mouse button.
   * Default value: `2`
   */
  simulationRepulsionFromMouse?: number;
  /**
   * Enable or disable the repulsion force from mouse when right-clicking.
   * When set to `true`, holding the right mouse button will activate the mouse repulsion force.
   * When set to `false`, right-clicking will not trigger any repulsion force.
   * Default value: `false`
   */
  enableRightClickRepulsion?: boolean;
  /**
   * Friction coefficient.
   * Values range from 0 (high friction, stops quickly) to 1 (no friction, keeps moving).
   * Default value: `0.85`
   */
  simulationFriction?: number;
  /**
   * Cluster coefficient.
   * Default value: `0.1`
   */
  simulationCluster?: number;

  /**
   * Callback function that will be called when the simulation starts.
   * Default value: `undefined`
   */
  onSimulationStart?: () => void;
  /**
   * Callback function that will be called on every simulation tick.
   * The value of the first argument `alpha` will decrease over time as the simulation "cools down".
   * If there's a point under the mouse pointer, its index will be passed as the second argument
   * and position as the third argument:
   * `(alpha: number, hoveredIndex: number | undefined, pointPosition: [number, number] | undefined) => void`.
   * Default value: `undefined`
   */
  onSimulationTick?: (
    alpha: number, hoveredIndex?: number, pointPosition?: [number, number]
    ) => void;
  /**
   * Callback function that will be called when the simulation stops.
   * Default value: `undefined`
   */
  onSimulationEnd?: () => void;
  /**
   * Callback function that will be called when the simulation gets paused.
   * Default value: `undefined`
   */
  onSimulationPause?: () => void;
  /**
   * Callback function that will be called when the simulation is restarted.
   * @deprecated Use `onSimulationUnpause` instead. This callback will be removed in a future version.
   * Default value: `undefined`
   */
  onSimulationRestart?: () => void;
  /**
   * Callback function that will be called when the simulation is unpaused.
   * Default value: `undefined`
   */
  onSimulationUnpause?: () => void;

  /**
   * Callback function that will be called on every canvas click.
   * If clicked on a point, its index will be passed as the first argument,
   * position as the second argument and the corresponding mouse event as the third argument:
   * `(index: number | undefined, pointPosition: [number, number] | undefined, event: MouseEvent) => void`.
   * Default value: `undefined`
   */
  onClick?: (
    index: number | undefined, pointPosition: [number, number] | undefined, event: MouseEvent
  ) => void;

  /**
   * Callback function that will be called when a point is clicked.
   * The point index will be passed as the first argument,
   * position as the second argument and the corresponding mouse event as the third argument:
   * `(index: number, pointPosition: [number, number], event: MouseEvent) => void`.
   * Default value: `undefined`
   */
  onPointClick?: (
    index: number,
    pointPosition: [number, number],
    event: MouseEvent
  ) => void;

  /**
   * Callback function that will be called when a link is clicked.
   * The link index will be passed as the first argument and the corresponding mouse event as the second argument:
   * `(linkIndex: number, event: MouseEvent) => void`.
   * Default value: `undefined`
   */
  onLinkClick?: (
    linkIndex: number,
    event: MouseEvent
  ) => void;

  /**
   * Callback function that will be called when the background (empty space) is clicked.
   * The mouse event will be passed as the first argument:
   * `(event: MouseEvent) => void`.
   * Default value: `undefined`
   */
  onBackgroundClick?: (
    event: MouseEvent
  ) => void;

  /**
   * Callback function that will be called when mouse movement happens.
   * If the mouse moves over a point, its index will be passed as the first argument,
   * position as the second argument and the corresponding mouse event as the third argument:
   * `(index: number | undefined, pointPosition: [number, number] | undefined, event: MouseEvent) => void`.
   * Default value: `undefined`
   */
  onMouseMove?: (
    index: number | undefined, pointPosition: [number, number] | undefined, event: MouseEvent
  ) => void;

  /**
   * Callback function that will be called when a point appears under the mouse
   * as a result of a mouse event, zooming and panning, or movement of points.
   * The point index will be passed as the first argument, position as the second argument
   * and the corresponding mouse event or D3's zoom event as the third argument:
   * `(index: number, pointPosition: [number, number], event: MouseEvent | D3DragEvent<HTMLCanvasElement, undefined, Hovered>
   * | D3ZoomEvent<HTMLCanvasElement, undefined> | undefined) => void`.
   * Default value: `undefined`
   */
  onPointMouseOver?: (
    index: number,
    pointPosition: [number, number],
    event: MouseEvent | D3DragEvent<HTMLCanvasElement, undefined, Hovered> | D3ZoomEvent<HTMLCanvasElement, undefined> | undefined
  ) => void;

  /**
   * Callback function that will be called when a point is no longer underneath
   * the mouse pointer because of a mouse event, zoom/pan event, or movement of points.
   * The corresponding mouse event or D3's zoom event will be passed as the first argument:
   * `(event: MouseEvent | D3ZoomEvent<HTMLCanvasElement, undefined> | D3DragEvent<HTMLCanvasElement, undefined, Hovered> | undefined) => void`.
   * Default value: `undefined`
   */
  onPointMouseOut?: (event: MouseEvent | D3ZoomEvent<HTMLCanvasElement, undefined> | D3DragEvent<HTMLCanvasElement, undefined, Hovered> | undefined) => void;

  /**
   * Callback function that will be called when the mouse moves over a link.
   * The link index will be passed as the first argument:
   * `(linkIndex: number) => void`.
   * Default value: `undefined`
   */
  onLinkMouseOver?: (linkIndex: number) => void;

  /**
   * Callback function that will be called when the mouse moves out of a link.
   * The event will be passed as the first argument:
   * `(event: MouseEvent | D3ZoomEvent<HTMLCanvasElement, undefined> | D3DragEvent<HTMLCanvasElement, undefined, Hovered> | undefined) => void`.
   * Default value: `undefined`
   */
  onLinkMouseOut?: (event: MouseEvent | D3ZoomEvent<HTMLCanvasElement, undefined> | D3DragEvent<HTMLCanvasElement, undefined, Hovered> | undefined) => void;

  /**
   * Callback function that will be called when zooming or panning starts.
   * First argument is a D3 Zoom Event and second indicates whether
   * the event has been initiated by a user interaction (e.g. a mouse event):
   * `(event: D3ZoomEvent, userDriven: boolean) => void`.
   * Default value: `undefined`
   */
  onZoomStart?: (e: D3ZoomEvent<HTMLCanvasElement, undefined>, userDriven: boolean) => void;

  /**
   * Callback function that will be called continuously during zooming or panning.
   * First argument is a D3 Zoom Event and second indicates whether
   * the event has been initiated by a user interaction (e.g. a mouse event):
   * `(event: D3ZoomEvent, userDriven: boolean) => void`.
   * Default value: `undefined`
   */
  onZoom?: (e: D3ZoomEvent<HTMLCanvasElement, undefined>, userDriven: boolean) => void;

  /**
   * Callback function that will be called when zooming or panning ends.
   * First argument is a D3 Zoom Event and second indicates whether
   * the event has been initiated by a user interaction (e.g. a mouse event):
   * `(event: D3ZoomEvent, userDriven: boolean) => void`.
   * Default value: `undefined`
   */
  onZoomEnd?: (e: D3ZoomEvent<HTMLCanvasElement, undefined>, userDriven: boolean) => void;

  /**
   * Callback function that will be called when dragging starts.
   * First argument is a D3 Drag Event:
   * `(event: D3DragEvent) => void`.
   * Default value: `undefined`
   */
  onDragStart?: (e: D3DragEvent<HTMLCanvasElement, undefined, Hovered>) => void;

  /**
   * Callback function that will be called continuously during dragging.
   * First argument is a D3 Drag Event:
   * `(event: D3DragEvent) => void`.
   * Default value: `undefined`
   */
  onDrag?: (e: D3DragEvent<HTMLCanvasElement, undefined, Hovered>) => void;

  /**
   * Callback function that will be called when dragging ends.
   * First argument is a D3 Drag Event:
   * `(event: D3DragEvent) => void`.
   * Default value: `undefined`
   */
  onDragEnd?: (e: D3DragEvent<HTMLCanvasElement, undefined, Hovered>) => void;

  /**
   * Show WebGL performance monitor.
   * Default value: `false`
   */
  showFPSMonitor?: boolean;
  /**
   * Canvas pixel ratio.
   * Default value: `2`
   */
  pixelRatio?: number;
  /**
   * Increase or decrease the size of the points when zooming in or out.
   * Default value: `false`
   */
  scalePointsOnZoom?: boolean;
  /**
   * Initial zoom level. Can be set once during graph initialization.
   * If set, `fitViewOnInit` value will be ignored.
   * Default value: `undefined`
   */
  initialZoomLevel?: number;
  /**
   * Enables or disables zooming in and out.
   * Default: `true`
   */
  enableZoom?: boolean;
  /**
   * Controls whether the simulation remains active during zoom operations.
   * When set to `true`, the simulation continues running while zooming.
   * When set to `false`, the simulation pauses during zoom operations.
   * Default value: `false`
   */
  enableSimulationDuringZoom?: boolean;
  /**
   * Enables or disables dragging of points in the graph.
   * Default value: `false`
   */
  enableDrag?: boolean;
  /**
   * Whether to center and zoom the view to fit all points in the scene on initialization or not.
   * Ignored if `initialZoomLevel` is set.
   * Default: `true`
   */
  fitViewOnInit?: boolean;
  /**
   * Delay in milliseconds before fitting the view when `fitViewOnInit` is enabled.
   * Useful if you want the layout to stabilize a bit before fitting.
   * Default: `250`
   */
  fitViewDelay?: number;
  /**
   * Padding to apply when fitting the view to show all points.
   * This value is added to the calculated bounding box to provide some extra space around the points.
   * This is used when the `fitViewOnInit` option is enabled.
   * Default: `0.1`
   */
  fitViewPadding?: number;
  /**
   * Duration in milliseconds for fitting the view to show all points when fitViewOnInit is enabled.
   * Default: `250`
   */
  fitViewDuration?: number;
  /**
   * When `fitViewOnInit` is set to `true`, fits the view to show the points within a rectangle
   * defined by its two corner coordinates `[[left, bottom], [right, top]]` in the scene space.
   * Default: `undefined`
   */
  fitViewByPointsInRect?: [[number, number], [number, number]] | [number, number][];
  /**
   * When `fitViewOnInit` is set to `true`, fits the view to show only the specified points by their indices.
   * Takes precedence over `fitViewByPointsInRect` when both are provided.
   * Default: `undefined`
   */
  fitViewByPointIndices?: number[];
  /**
   * Providing a `randomSeed` value allows you to control
   * the randomness of the layout across different simulation runs.
   * It is useful when you want the graph to always look the same on same datasets.
   * This property will be applied only on component initialization and it
   * can't be changed using the `setConfig` method.
   * Default value: undefined
   */
  randomSeed?: number | string;
  /**
   * Point sampling distance in pixels between neighboring points when calling the `getSampledPointPositionsMap` method.
   * This parameter determines how many points will be included in the sample.
   * Default value: `150`
  */
  pointSamplingDistance?: number;
  /**
   * Controls automatic position adjustment of points in the visible space.
   *
   * When `undefined` (default):
   * - If simulation is disabled (`enableSimulation: false`), points will be automatically
   *   repositioned to fit within the visible space
   * - If simulation is enabled, points will not be rescaled
   *
   * When explicitly set:
   * - `true`: Forces points positions to be rescaled
   * - `false`: Forces points positions to not be rescaled
   */
  rescalePositions?: boolean | undefined;
  /**
   * Controls the text shown in the bottom right corner.
   * - When a non-empty string is provided: Displays the string as HTML
   * - When empty string or not provided: No text is displayed
   */
  attribution?: string;
}

export class GraphConfig implements GraphConfigInterface {
  public enableSimulation = defaultConfigValues.enableSimulation
  public backgroundColor = defaultBackgroundColor
  public spaceSize = defaultConfigValues.spaceSize
  public pointColor = defaultPointColor
  // TODO: When pointColor is removed, change this to:
  // public pointDefaultColor = defaultPointColor
  // Currently undefined to allow fallback to deprecated pointColor via nullish coalescing
  // in GraphData.updatePointColor() (see: this._config.pointDefaultColor ?? this._config.pointColor)
  public pointDefaultColor = undefined
  public pointGreyoutOpacity = defaultGreyoutPointOpacity
  public pointGreyoutColor = defaultGreyoutPointColor
  public pointSize = defaultPointSize
  // TODO: When pointSize is removed, change this to:
  // public pointDefaultSize = defaultPointSize
  // Currently undefined to allow fallback to deprecated pointSize via nullish coalescing
  // in GraphData.updatePointSize() (see: this._config.pointDefaultSize ?? this._config.pointSize)
  public pointDefaultSize = undefined
  public pointOpacity = defaultPointOpacity
  public pointSizeScale = defaultConfigValues.pointSizeScale
  public hoveredPointCursor = defaultConfigValues.hoveredPointCursor
  public hoveredLinkCursor = defaultConfigValues.hoveredLinkCursor
  public renderHoveredPointRing = defaultConfigValues.renderHoveredPointRing
  public hoveredPointRingColor = defaultConfigValues.hoveredPointRingColor
  public focusedPointRingColor = defaultConfigValues.focusedPointRingColor
  public focusedPointIndex = defaultConfigValues.focusedPointIndex
  public linkColor = defaultLinkColor
  // TODO: When linkColor is removed, change this to:
  // public linkDefaultColor = defaultLinkColor
  // Currently undefined to allow fallback to deprecated linkColor via nullish coalescing
  // in GraphData.updateLinkColor() (see: this._config.linkDefaultColor ?? this._config.linkColor)
  public linkDefaultColor = undefined
  public linkOpacity = defaultLinkOpacity
  public linkGreyoutOpacity = defaultGreyoutLinkOpacity
  public linkWidth = defaultLinkWidth
  // TODO: When linkWidth is removed, change this to:
  // public linkDefaultWidth = defaultLinkWidth
  // Currently undefined to allow fallback to deprecated linkWidth via nullish coalescing
  // in GraphData.updateLinkWidth() (see: this._config.linkDefaultWidth ?? this._config.linkWidth)
  public linkDefaultWidth = undefined
  public linkWidthScale = defaultConfigValues.linkWidthScale
  public hoveredLinkColor = defaultConfigValues.hoveredLinkColor
  public hoveredLinkWidthIncrease = defaultConfigValues.hoveredLinkWidthIncrease
  public renderLinks = defaultConfigValues.renderLinks
  public curvedLinks = defaultConfigValues.curvedLinks
  public curvedLinkSegments = defaultConfigValues.curvedLinkSegments
  public curvedLinkWeight = defaultConfigValues.curvedLinkWeight
  public curvedLinkControlPointDistance = defaultConfigValues.curvedLinkControlPointDistance
  public linkArrows = defaultConfigValues.linkArrows
  // TODO: When linkArrows is removed, change this to:
  // public linkDefaultArrows = defaultConfigValues.linkArrows
  // Currently undefined to allow fallback to deprecated linkArrows via nullish coalescing
  // in GraphData.updateArrows() (see: this._config.linkDefaultArrows ?? this._config.linkArrows)
  public linkDefaultArrows = undefined
  public linkArrowsSizeScale = defaultConfigValues.linkArrowsSizeScale
  public scaleLinksOnZoom = defaultConfigValues.scaleLinksOnZoom
  public linkVisibilityDistanceRange = defaultConfigValues.linkVisibilityDistanceRange
  public linkVisibilityMinTransparency = defaultConfigValues.linkVisibilityMinTransparency
  public useClassicQuadtree = defaultConfigValues.useClassicQuadtree

  public simulationDecay = defaultConfigValues.simulation.decay
  public simulationGravity = defaultConfigValues.simulation.gravity
  public simulationCenter = defaultConfigValues.simulation.center
  public simulationRepulsion = defaultConfigValues.simulation.repulsion
  public simulationRepulsionTheta = defaultConfigValues.simulation.repulsionTheta
  public simulationRepulsionQuadtreeLevels = defaultConfigValues.simulation.repulsionQuadtreeLevels
  public simulationLinkSpring = defaultConfigValues.simulation.linkSpring
  public simulationLinkDistance = defaultConfigValues.simulation.linkDistance
  public simulationLinkDistRandomVariationRange = defaultConfigValues.simulation.linkDistRandomVariationRange
  public simulationRepulsionFromMouse = defaultConfigValues.simulation.repulsionFromMouse
  public enableRightClickRepulsion = defaultConfigValues.enableRightClickRepulsion
  public simulationFriction = defaultConfigValues.simulation.friction
  public simulationCluster = defaultConfigValues.simulation.cluster

  public onSimulationStart: GraphConfigInterface['onSimulationStart'] = undefined
  public onSimulationTick: GraphConfigInterface['onSimulationTick'] = undefined
  public onSimulationEnd: GraphConfigInterface['onSimulationEnd'] = undefined
  public onSimulationPause: GraphConfigInterface['onSimulationPause'] = undefined
  public onSimulationRestart: GraphConfigInterface['onSimulationRestart'] = undefined
  public onSimulationUnpause: GraphConfigInterface['onSimulationUnpause'] = undefined

  public onClick: GraphConfigInterface['onClick'] = undefined
  public onPointClick: GraphConfigInterface['onPointClick'] = undefined
  public onLinkClick: GraphConfigInterface['onLinkClick'] = undefined
  public onBackgroundClick: GraphConfigInterface['onBackgroundClick'] = undefined
  public onMouseMove: GraphConfigInterface['onMouseMove'] = undefined
  public onPointMouseOver: GraphConfigInterface['onPointMouseOver'] = undefined
  public onPointMouseOut: GraphConfigInterface['onPointMouseOut'] = undefined
  public onLinkMouseOver: GraphConfigInterface['onLinkMouseOver'] = undefined
  public onLinkMouseOut: GraphConfigInterface['onLinkMouseOut'] = undefined
  public onZoomStart: GraphConfigInterface['onZoomStart'] = undefined
  public onZoom: GraphConfigInterface['onZoom'] = undefined
  public onZoomEnd: GraphConfigInterface['onZoomEnd'] = undefined
  public onDragStart: GraphConfigInterface['onDragStart'] = undefined
  public onDrag: GraphConfigInterface['onDrag'] = undefined
  public onDragEnd: GraphConfigInterface['onDragEnd'] = undefined

  public showFPSMonitor = defaultConfigValues.showFPSMonitor

  public pixelRatio = defaultConfigValues.pixelRatio

  public scalePointsOnZoom = defaultConfigValues.scalePointsOnZoom
  public initialZoomLevel = undefined
  public enableZoom = defaultConfigValues.enableZoom
  public enableSimulationDuringZoom = defaultConfigValues.enableSimulationDuringZoom
  public enableDrag = defaultConfigValues.enableDrag
  public fitViewOnInit = defaultConfigValues.fitViewOnInit
  public fitViewDelay = defaultConfigValues.fitViewDelay
  public fitViewPadding = defaultConfigValues.fitViewPadding
  public fitViewDuration = defaultConfigValues.fitViewDuration
  public fitViewByPointsInRect = undefined
  public fitViewByPointIndices = undefined

  public randomSeed = undefined
  public pointSamplingDistance = defaultConfigValues.pointSamplingDistance
  public attribution = defaultConfigValues.attribution
  public rescalePositions = defaultConfigValues.rescalePositions

  public init (config: GraphConfigInterface): void {
    (Object.keys(config) as (keyof GraphConfigInterface)[])
      .forEach(configParameter => {
        this.deepMergeConfig(this.getConfig(), config, configParameter)
      })
  }

  public deepMergeConfig <T> (current: T, next: T, key: keyof T): void {
    if (isPlainObject(current[key]) && isPlainObject(next[key])) {
      // eslint-disable-next-line @typescript-eslint/ban-types
      (Object.keys(next[key] as Object) as (keyof T[keyof T])[])
        .forEach(configParameter => {
          this.deepMergeConfig(current[key], next[key], configParameter)
        })
    } else current[key] = next[key]
  }

  private getConfig (): GraphConfigInterface {
    return this
  }
}
