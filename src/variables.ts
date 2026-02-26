export const defaultPointColor = '#b3b3b3'
export const defaultGreyoutPointOpacity = undefined
export const defaultGreyoutPointColor = undefined
export const defaultPointOpacity = 1.0
export const defaultPointSize = 4
export const defaultLinkColor = '#666666'
export const defaultGreyoutLinkOpacity = 0.1
export const defaultLinkOpacity = 1.0
export const defaultLinkWidth = 1
export const defaultBackgroundColor = '#222222'

export const defaultConfigValues = {
  enableSimulation: true,
  /** Setting to 4096 because larger values crash the graph on iOS. More info: https://github.com/cosmosgl/graph/issues/203 */
  spaceSize: 4096,
  pointSizeScale: 1,
  linkWidthScale: 1,
  linkArrowsSizeScale: 1,
  renderLinks: true,
  curvedLinks: false,
  curvedLinkSegments: 19,
  curvedLinkWeight: 0.8,
  curvedLinkControlPointDistance: 0.5,
  linkArrows: false,
  linkVisibilityDistanceRange: [50, 150],
  linkVisibilityMinTransparency: 0.25,
  hoveredPointCursor: 'auto',
  hoveredLinkCursor: 'auto',
  renderHoveredPointRing: false,
  hoveredPointRingColor: 'white',
  hoveredLinkColor: undefined,
  hoveredLinkWidthIncrease: 5,
  focusedPointRingColor: 'white',
  focusedPointIndex: undefined,
  simulation: {
    decay: 5000,
    gravity: 0.25,
    center: 0,
    repulsion: 1.0,
    repulsionTheta: 1.15,
    linkSpring: 1,
    linkDistance: 10,
    linkDistRandomVariationRange: [1, 1.2],
    repulsionFromMouse: 2,
    friction: 0.85,
    cluster: 0.1,
  },
  showFPSMonitor: false,
  pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2,
  scalePointsOnZoom: false,
  scaleLinksOnZoom: false,
  enableZoom: true,
  enableSimulationDuringZoom: false,
  enableDrag: false,
  fitViewOnInit: true,
  fitViewDelay: 250,
  fitViewPadding: 0.1,
  fitViewDuration: 250,
  pointSamplingDistance: 150,
  attribution: '',
  rescalePositions: undefined,
  enableRightClickRepulsion: false,
}

export const hoveredPointRingOpacity = 0.7
export const focusedPointRingOpacity = 0.95
export const defaultScaleToZoom = 3
