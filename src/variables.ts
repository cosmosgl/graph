import type { GraphConfigInterface, Complete } from '@/graph/config'
import { PointShape } from '@/graph/modules/GraphData'

/**
 * Default values for all graph configuration properties.
 */
export const defaultConfigValues = {
  // General
  enableSimulation: true,
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
  linkOpacity: 1.0,
  linkGreyoutOpacity: 0.1,
  linkWidthScale: 1,
  scaleLinksOnZoom: false,
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
  enableRightClickRepulsion: false,

  // Simulation callbacks
  onSimulationStart: undefined,
  onSimulationTick: undefined,
  onSimulationEnd: undefined,
  onSimulationPause: undefined,
  onSimulationUnpause: undefined,

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
