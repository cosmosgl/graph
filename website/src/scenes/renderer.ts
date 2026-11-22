import { Graph } from '@cosmos.gl/graph'
import type { SceneDefinition } from './types'
import { createSimulatedScene } from './simulation'
import { createStressScene } from './stress'

export interface SceneControls {
  destroy: () => void;
  setPaused?: (paused: boolean) => void;
  fitView?: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
}

/** One cosmos instance is mounted at a time, regardless of the number of studies. */
export async function createScene (
  container: HTMLDivElement,
  definition: SceneDefinition,
  still = false,
  initialTime = 8,
  signal?: AbortSignal
): Promise<SceneControls> {
  if (definition.benchmark) return createStressScene(container, still, signal)
  if (definition.dataset) {
    const { createDatasetScene } = await import('./dataset-scene')
    return createDatasetScene(container, definition, signal)
  }
  if (definition.simulation) return createSimulatedScene(container, definition, still, initialTime, signal)
  let seed = 2166136261
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    return (seed >>> 0) / 4294967296
  }
  signal?.throwIfAborted()
  const data = await definition.create(random, signal)
  signal?.throwIfAborted()
  const positions = new Float32Array(data.positions.length)
  const colors = new Float32Array(data.colors.length)
  const sizes = Float32Array.from(data.sizes, size => size * 1.25)
  const linkColors = data.linkColors?.map((value, i) => i % 4 === 3 ? Math.min(1, value * 1.7) : value)
  const linkWidths = data.linkWidths?.map(value => value * 1.2)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const viewWidth = 3350
  const viewHeight = 2600
  const graph = new Graph(container, {
    backgroundColor: definition.background,
    enableSimulation: false,
    enableRenderLoop: true,
    rescalePositions: false,
    spaceSize: 4096,
    transitionDuration: 0,
    enableZoom: true,
    enableDrag: false,
    scalePointsOnZoom: false,
    scaleLinksOnZoom: false,
    pointOcclusionCulling: false,
    renderHoveredPointRing: false,
    curvedLinks: false,
    fitViewOnInit: false,
    renderLinks: Boolean(data.links?.length),
    pixelRatio: Math.min(devicePixelRatio || 1, 2),
    attribution: '',
  })

  const abortInitialization = (): void => { graph.destroy() }
  signal?.addEventListener('abort', abortInitialization, { once: true })
  try {
    signal?.throwIfAborted()
    await graph.ready
    signal?.throwIfAborted()
  } catch (error) {
    graph.destroy()
    throw error
  } finally {
    signal?.removeEventListener('abort', abortInitialization)
  }

  let destroyed = false
  let paused = still || reducedMotion.matches
  let time = initialTime
  let lastTime = 0
  let frame = 0
  let onscreen = true

  const draw = (): void => {
    data.update?.(time)
    for (let i = 0; i < positions.length; i++) positions[i] = 2048 + data.positions[i]! * 1000
    for (let i = 0; i < colors.length; i++) colors[i] = i % 4 === 3 ? Math.min(1, data.colors[i]! * 1.8) : data.colors[i]!
    graph.setPointPositions(positions)
    graph.setPointColors(colors)
    graph.render(0, 0)
  }

  const fitView = (duration = 0): void => {
    if (destroyed) return
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    const scale = Math.min(width / viewWidth, height / viewHeight)
    // Preserve the studies' slightly raised framing while synchronizing d3's camera.
    const centerY = 2048 - height * 0.06 / scale
    graph.setZoomTransformByPointPositions(new Float32Array([
      2048 - viewWidth / 2, centerY - viewHeight / 2,
      2048 + viewWidth / 2, centerY + viewHeight / 2,
    ]), duration, undefined, 0, false)
  }

  const zoomBy = (factor: number): void => {
    if (destroyed) return
    graph.setZoomLevel(graph.getZoomLevel() * factor, reducedMotion.matches ? 0 : 200, false)
  }

  const canAnimate = (): boolean => !destroyed && !paused && onscreen && !document.hidden

  const tick = (now: number): void => {
    frame = 0
    if (!canAnimate()) return
    if (!lastTime) lastTime = now
    const elapsed = now - lastTime
    if (elapsed >= 32) {
      time += Math.min(elapsed, 80) / 1000
      lastTime = now
      draw()
    }
    frame = requestAnimationFrame(tick)
  }

  const sync = (): void => {
    if (canAnimate()) {
      if (!frame) {
        lastTime = 0
        frame = requestAnimationFrame(tick)
      }
    } else {
      cancelAnimationFrame(frame)
      frame = 0
      lastTime = 0
    }
  }

  const preferenceChanged = (): void => {
    paused = still || reducedMotion.matches
    sync()
  }
  const intersectionObserver = new IntersectionObserver(entries => {
    onscreen = entries[0]?.isIntersecting ?? false
    sync()
  })
  const controls: SceneControls = {
    destroy: (): void => {
      if (destroyed) return
      destroyed = true
      cancelAnimationFrame(frame)
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', sync)
      reducedMotion.removeEventListener('change', preferenceChanged)
      signal?.removeEventListener('abort', controls.destroy)
      graph.destroy()
    },
    setPaused: (value: boolean): void => {
      paused = value
      sync()
    },
    fitView: (): void => { fitView(reducedMotion.matches ? 0 : 300) },
    zoomIn: (): void => { zoomBy(1.5) },
    zoomOut: (): void => { zoomBy(1 / 1.5) },
  }
  if (signal?.aborted || !container.isConnected) {
    controls.destroy()
    return controls
  }

  graph.setPointSizes(sizes)
  if (data.links) graph.setLinks(data.links)
  if (linkColors) graph.setLinkColors(linkColors)
  if (linkWidths) graph.setLinkWidths(linkWidths)
  draw()
  fitView()
  intersectionObserver.observe(container)
  document.addEventListener('visibilitychange', sync)
  reducedMotion.addEventListener('change', preferenceChanged)
  signal?.addEventListener('abort', controls.destroy, { once: true })
  sync()
  return controls
}
