import { type GraphConfig } from '@cosmos.gl/graph'

export const config: GraphConfig = {
  spaceSize: 4096,
  // Points keep the exact positions we set — no simulation, no auto-rescale — so a
  // point appears exactly where you click and the others never move.
  enableSimulation: false,
  rescalePositions: false,
  transitionDuration: 600,
  backgroundColor: '#2d313a',
  pointDefaultSize: 40,
  pointDefaultColor: '#4B5BBF',
  // Links show what happens to a removed point's edges: the engine fades them out
  // with the point (no need to drop them from the array before compacting).
  linkDefaultWidth: 2,
  linkDefaultColor: '#8890b0',
  // Keep points a constant on-screen size regardless of zoom, so they stay clearly
  // visible in this interactive demo.
  scalePointsOnZoom: false,
  // Ring under the cursor shows which point a click will remove.
  hoveredPointCursor: 'pointer',
  renderHoveredPointRing: true,
  hoveredPointRingColor: '#ffffff',
  fitViewOnInit: true,
  fitViewPadding: 0.4,
  attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
}
