import { Graph } from '@cosmos.gl/graph'
import { loadDataset } from './dataset-loader'
import type { SceneControls } from './renderer'
import type { DatasetSceneDefinition } from './types'

/** Keep the loader up until the first full draw has completed on the GPU. */
async function waitForInitialDraw (container: HTMLDivElement, signal?: AbortSignal): Promise<void> {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  signal?.throwIfAborted()
  const gl = container.querySelector('canvas')?.getContext('webgl2')
  if (!gl || gl.isContextLost()) throw new Error('The GPU could not open the full graph.')
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
  if (!fence) throw new Error('The GPU could not start the first frame.')
  const deadline = performance.now() + 30000
  gl.flush()
  try {
    while (true) {
      signal?.throwIfAborted()
      const status = gl.clientWaitSync(fence, 0, 0)
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break
      if (status === gl.WAIT_FAILED || performance.now() >= deadline) throw new Error('The GPU could not draw the full graph.')
      await new Promise<void>(resolve => window.setTimeout(resolve, 16))
    }
    if (gl.getError() !== gl.NO_ERROR) throw new Error('A GPU error interrupted the full graph draw.')
  } finally {
    gl.deleteSync(fence)
  }
}

/** Static datasets upload once; the engine draws on camera/input changes. */
export async function createDatasetScene (
  container: HTMLDivElement,
  definition: DatasetSceneDefinition,
  signal?: AbortSignal
): Promise<SceneControls> {
  const { dataset } = definition
  const { positions, links: indices } = await loadDataset(dataset.file, definition.pointCount, definition.linkCount, signal)
  signal?.throwIfAborted()

  const links = Float32Array.from(indices)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < positions.length; i += 2) {
    const x = 2048 + positions[i]! * 1000
    const y = 2048 + positions[i + 1]! * 1000
    positions[i] = x
    positions[i + 1] = y
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const fitScale = (): number => Math.min(
    Math.max(1, container.clientWidth) * 0.83 / Math.max(1, maxX - minX),
    Math.max(1, container.clientHeight) * (container.clientWidth <= 700 ? 0.48 : 0.78) / Math.max(1, maxY - minY)
  )
  const graph = new Graph(container, {
    backgroundColor: definition.background,
    spaceSize: 4096,
    rescalePositions: false,
    enableSimulation: false,
    enableDrag: false,
    enableZoom: true,
    fitViewOnInit: false,
    transitionDuration: 0,
    pixelRatio: 1,
    pointDefaultColor: dataset.pointColor,
    pointDefaultSize: dataset.pointSize,
    pointOcclusionCulling: false,
    renderHoveredPointRing: false,
    linkDefaultColor: dataset.linkColor,
    linkDefaultWidth: dataset.linkWidth,
    linkVisibilityDistanceRange: [0, 5000],
    linkVisibilityMinTransparency: 1,
    linkDefaultArrows: false,
    scalePointsOnZoom: false,
    scaleLinksOnZoom: false,
    attribution: '',
  })
  let destroyed = false
  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    signal?.removeEventListener('abort', destroy)
    graph.destroy()
  }
  signal?.addEventListener('abort', destroy, { once: true })
  const fitView = (duration: number): void => {
    if (destroyed) return
    const scale = fitScale()
    const offset = container.clientHeight * (container.clientWidth <= 700 ? 0.12 : 0.05) / scale
    const bounds = new Float32Array([minX, minY - offset, maxX, maxY - offset])
    graph.setZoomTransformByPointPositions(bounds, duration, scale, 0, false)
  }
  try {
    await graph.ready
    signal?.throwIfAborted()
    graph.setPointPositions(positions, true)
    graph.setLinks(links)
    graph.render(0, 0)
    const query = new URLSearchParams(window.location.search)
    if (query.has('capture') && query.has('overview')) fitView(0)
    else {
      const { center, height } = dataset.initialView
      graph.setZoomTransformByPointPositions(
        Float32Array.from(center, value => 2048 + value * 1000),
        0, Math.max(1, container.clientHeight) / (height * 1000), 0, false
      )
    }
    await waitForInitialDraw(container, signal)
    const uploaded = graph.getPointPositionTexture()?.pointCount
    if (uploaded !== definition.pointCount) throw new Error('The uploaded point count does not match the dataset.')
    container.setAttribute('data-points', String(uploaded))
    container.setAttribute('data-links', String(definition.linkCount))
  } catch (error) {
    destroy()
    throw error
  }
  const zoom = (factor: number): void => {
    if (!destroyed) graph.setZoomLevel(graph.getZoomLevel() * factor, reducedMotion.matches ? 0 : 200, false)
  }
  return {
    destroy,
    fitView: (): void => { fitView(reducedMotion.matches ? 0 : 300) },
    zoomIn: (): void => { zoom(1.5) },
    zoomOut: (): void => { zoom(1 / 1.5) },
  }
}
