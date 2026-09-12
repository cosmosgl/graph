import type { GraphConfigInterface, Complete } from '@/graph/config'
import { PointShape, LinkStyle } from '@/graph/modules/GraphData'
import { TransitionEasing } from '@/graph/modules/Transition'

/**
 * Default values for all graph configuration properties.
 */
export const defaultConfigValues = {
  // General
  enableSimulation: true,
  transitionDuration: 800,
  transitionEasing: TransitionEasing.CubicInOut,
  backgroundColor: '#222222',
  /** Setting to 4096 because larger values crash the graph on iOS. More info: https://github.com/cosmosgl/graph/issues/203 */
  spaceSize: 4096,

  // Points
  pointDefaultColor: '#b3b3b3',
  pointDefaultSize: 4,
  pointDefaultShape: PointShape.Circle,
  pointOpacity: 1.0,
  pointGreyoutOpacity: undefined,
  pointGreyoutColor: undefined,
  pointSizeScale: 1,
  pointOcclusionCulling: true,
  scalePointsOnZoom: false,

  // Point interaction
  hoveredPointCursor: 'auto',
  renderHoveredPointRing: false,
  hoveredPointRingColor: 'white',
  focusedPointRingColor: 'white',
  focusedPointIndex: undefined,
  highlightedPointIndices: undefined,
  outlinedPointIndices: undefined,
  outlinedPointRingColor: 'white',

  // Links
  renderLinks: true,
  linkDefaultColor: '#666666',
  linkDefaultWidth: 1,
  linkDefaultStyle: LinkStyle.Solid,
  linkDashLength: 8,
  linkDashGap: 4,
  linkColorInterpolateFromEndpoints: false,
  linkOpacity: 1.0,
  linkGreyoutOpacity: 0.1,
  linkWidthScale: 1,
  scaleLinksOnZoom: false,
  linkBlending: true,
  curvedLinks: false,
  curvedLinkSegments: 19,
  curvedLinkWeight: 0.8,
  curvedLinkControlPointDistance: 0.5,
  linkDefaultArrows: false,
  linkArrowsSizeScale: 1,
  linkVisibilityDistanceRange: [50, 150],
  linkVisibilityMinTransparency: 0.25,

  // Link interaction
  hoveredLinkCursor: 'auto',
  hoveredLinkColor: undefined,
  hoveredLinkWidthIncrease: 5,
  highlightedLinkIndices: undefined,
  focusedLinkIndex: undefined,
  focusedLinkWidthIncrease: 5,

  // Simulation
  simulationDecay: 5000,
  simulationGravity: 0.25,
  simulationCenter: 0,
  simulationRepulsion: 1.0,
  simulationRepulsionTheta: 1.15,
  simulationLinkSpring: 1,
  simulationLinkDistance: 10,
  simulationLinkDistRandomVariationRange: [1, 1.2],
  simulationRepulsionFromMouse: 2,
  simulationFriction: 0.85,
  simulationCluster: 0.1,
  simulationCollision: 0,
  simulationCollisionRadius: undefined,
  simulationCollisionPadding: 0,
  enableRightClickRepulsion: false,

  // Simulation callbacks
  onSimulationStart: undefined,
  onSimulationTick: undefined,
  onSimulationEnd: undefined,
  onSimulationPause: undefined,
  onSimulationUnpause: undefined,

  // Transition callbacks
  onTransitionStart: undefined,
  onTransition: undefined,
  onTransitionEnd: undefined,

  // Interaction callbacks
  onClick: undefined,
  onPointClick: undefined,
  onLinkClick: undefined,
  onBackgroundClick: undefined,
  onContextMenu: undefined,
  onPointContextMenu: undefined,
  onLinkContextMenu: undefined,
  onBackgroundContextMenu: undefined,
  onMouseMove: undefined,
  onPointMouseOver: undefined,
  onPointMouseOut: undefined,
  onLinkMouseOver: undefined,
  onLinkMouseOut: undefined,

  // Zoom and pan callbacks
  onZoomStart: undefined,
  onZoom: undefined,
  onZoomEnd: undefined,

  // Drag callbacks
  onDragStart: undefined,
  onDrag: undefined,
  onDragEnd: undefined,

  // Display
  showFPSMonitor: false,
  pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2,

  // Zoom and pan
  enableZoom: true,
  enableSimulationDuringZoom: false,
  initialZoomLevel: undefined,

  // Drag
  enableDrag: false,

  // Fit view
  fitViewOnInit: true,
  fitViewDelay: 250,
  fitViewPadding: 0.1,
  fitViewDuration: 250,
  fitViewByPointsInRect: undefined,
  fitViewByPointIndices: undefined,

  // Sampling
  pointSamplingDistance: 100,
  linkSamplingDistance: 100,

  // Miscellaneous
  randomSeed: undefined,
  rescalePositions: undefined,
  attribution: '',
} satisfies Complete<GraphConfigInterface>

// Internal constants (not part of GraphConfigInterface)
export const hoveredPointRingOpacity = 0.7
export const focusedPointRingOpacity = 0.95

/**
 * What a `NaN` size/color channel of an **absent** (removed) point resolves to:
 * fade to nothing. The single source for both resolution sites — the CPU mirrors
 * (`GraphData.getResolvedPoint*`) and the draw shader (injected as `#define`s).
 */
export const EXIT_DEFAULT_SIZE = 0
export const EXIT_DEFAULT_COLOR_CHANNEL = 0

/**
 * Anti-aliasing ramp: the fade from coverage 1 to 0 at every edge the engine draws, in
 * device pixels, centred on the geometric edge. Reaches the point, link and highlight
 * shaders as the `EDGE_RAMP_PX` define.
 *
 *   coverage
 *   1 |███████░░
 *     |         ●        0.5 exactly on the edge
 *   0 |__________░░___   half the ramp inside, half outside
 *
 * A centred fade integrates to the same area as a hard edge, so ink is independent of shape
 * size and pixel ratio. Thinner than the ramp, each element keeps what matters for it:
 *
 *   link   → drawn at ramp width, alpha = width / ramp   (ink preserved)
 *   ring   → drawn at ramp width, alpha = 1              (visibility preserved)
 *   point  → 1 px core, alpha = shape² / core²           (ink preserved)
 *
 * 1.0 is the box filter: a straight edge deposits in each pixel exactly the area it covers.
 */
export const EDGE_RAMP_PX = 1.0

/**
 * A ring's outer radius over its point's radius, for the outline ring and the hover / focus
 * ring alike. Reaches the point and highlight shaders as the `POINT_RING_SCALE` define.
 */
export const POINT_RING_SCALE = 1.3
