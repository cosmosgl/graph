export const manualStepConfig = {
  backgroundColor: '#242832',
  pointDefaultSize: 22,
  linkDefaultColor: '#c1c6d0',
  linkDefaultWidth: 3,
  linkVisibilityMinTransparency: 1,
  pixelRatio: 1,
  fitViewOnInit: false,
  rescalePositions: false,
  simulationGravity: 1,
  simulationRepulsion: 0,
  simulationRepulsionFromMouse: 0,
  simulationLinkSpring: 0,
  simulationCenter: 0,
  simulationFriction: 1,
}

interface FixtureGraph {
  setPointPositions(xy: Float32Array): void;
  setPointColors(rgba: Float32Array): void;
  setLinks(links: Float32Array): void;
  setPinnedPoints(indices: number[]): void;
  render(alpha: number, duration: number): void;
  pause(): void;
}

/** Each invocation gets its own arrays, including when two Graph versions run in separate frames. */
export function loadManualStep (graph: FixtureGraph): void {
  graph.setPointPositions(new Float32Array([1984, 2048, 2112, 2048, NaN, NaN]))
  graph.setPointColors(new Float32Array([1, 0.4, 0.4, 1, 0.35, 0.8, 1, 1, 0, 0, 0, 0]))
  graph.setLinks(new Float32Array([0, 1]))
  graph.setPinnedPoints([0])
  graph.render(1, 0)
  graph.pause()
}
