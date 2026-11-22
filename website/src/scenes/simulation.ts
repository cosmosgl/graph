import { Graph } from '@cosmos.gl/graph'
import { createClusterLabels } from './cluster-labels'
import type { SceneControls } from './renderer'
import type { GeneratedSceneDefinition } from './types'

const FIT_PADDING = 0.08

/** Live forces own positions here; procedural studies keep their existing renderer. */
export async function createSimulatedScene (
  container: HTMLDivElement,
  definition: GeneratedSceneDefinition,
  still: boolean,
  initialTime: number,
  signal?: AbortSignal
): Promise<SceneControls> {
  let seed = 2166136261
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    return (seed >>> 0) / 4294967296
  }
  signal?.throwIfAborted()
  const data = await definition.create(random, signal)
  signal?.throwIfAborted()
  const initialPositions = Float32Array.from(data.positions, value => 2048 + value * 1000)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let paused = still || reducedMotion.matches
  let onscreen = true
  let destroyed = false
  let initialized = false
  let tick = 0
  let colorTick = 0
  let frame = 0
  let simulationEnded = false
  let clusterLabels: ReturnType<typeof createClusterLabels> | undefined
  const scalePointsOnZoom = definition.simulation?.scalePointsOnZoom ?? false
  const updateColors = (): boolean => {
    if (!data.updateColors || colorTick === tick) return false
    colorTick = tick
    data.updateColors(tick)
    graph.setPointColors(data.colors)
    return true
  }
  const refresh = (): void => {
    if (!initialized || destroyed || frame || (!clusterLabels && !data.updateColors)) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (updateColors()) graph.render(undefined, 0)
      clusterLabels?.draw(!simulationEnded)
      simulationEnded = false
    })
  }
  const tooltip = document.createElement('div')
  tooltip.className = 'network-tooltip'
  tooltip.hidden = true
  tooltip.setAttribute('aria-hidden', 'true')
  const hideTooltip = (): void => { tooltip.hidden = true }
  let pointerX = 0
  let pointerY = 0
  const showTooltip = (index: number | undefined): void => {
    const label = index === undefined ? undefined : data.pointLabels?.[index]
    if (!label) {
      hideTooltip()
      return
    }
    const rect = container.getBoundingClientRect()
    tooltip.textContent = label
    tooltip.style.left = `${Math.max(8, Math.min(rect.width - 220, pointerX - rect.left + 16))}px`
    tooltip.style.top = `${Math.max(8, pointerY - rect.top - 54)}px`
    tooltip.hidden = false
  }
  const graph = new Graph(container, {
    ...definition.simulation,
    backgroundColor: definition.background,
    enableSimulation: true,
    // Warmup runs a fixed number of GPU steps before the native loop takes over.
    enableRenderLoop: false,
    rescalePositions: false,
    spaceSize: 4096,
    transitionDuration: 0,
    fitViewOnInit: false,
    enableZoom: definition.simulation?.enableZoom ?? true,
    enableDrag: definition.simulation?.enableDrag ?? false,
    scalePointsOnZoom,
    scaleLinksOnZoom: false,
    enableSimulationDuringZoom: true,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#ffffff',
    pixelRatio: Math.min(devicePixelRatio || 1, 2),
    attribution: '',
    onMouseMove: (index, _position, event): void => {
      pointerX = event.clientX
      pointerY = event.clientY
      showTooltip(index)
    },
    onPointMouseOver: (index): void => { showTooltip(index) },
    onPointMouseOut: hideTooltip,
    onZoomStart: hideTooltip,
    onZoom: (event, userDriven): void => {
      definition.simulation?.onZoom?.(event, userDriven)
      refresh()
    },
    onSimulationTick: (alpha, hoveredIndex, position): void => {
      tick++
      definition.simulation?.onSimulationTick?.(alpha, hoveredIndex, position)
      refresh()
    },
    onSimulationEnd: (): void => {
      definition.simulation?.onSimulationEnd?.()
      simulationEnded = true
      refresh()
    },
  })

  const abortInitialization = (): void => { graph.destroy() }
  signal?.addEventListener('abort', abortInitialization, { once: true })
  try {
    signal?.throwIfAborted()
    await graph.ready
    signal?.throwIfAborted()
    graph.setPointPositions(initialPositions)
    graph.setPointColors(data.colors)
    graph.setPointSizes(data.sizes)
    if (data.pointClusters) graph.setPointClusters(data.pointClusters)
    if (data.links) graph.setLinks(data.links)
    if (data.linkColors) graph.setLinkColors(data.linkColors)
    if (data.linkWidths) graph.setLinkWidths(data.linkWidths)
    graph.render(1, 0)
    graph.pause()
    const steps = still || reducedMotion.matches
      ? Math.round(Math.max(0, Math.min(60, initialTime)) * 30)
      : definition.warmupSteps ?? 120
    for (let i = 0; i < steps; i++) {
      graph.step()
      // Present short batches so large captures never queue one long GPU task.
      // The graph is paused, so these presentation frames do not advance physics.
      if (i % 8 === 7) {
        graph.renderOneFrame()
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      signal?.throwIfAborted()
      if (!container.isConnected) break
    }
    graph.fitView(0, FIT_PADDING, false)
    // The zero-duration fit still completes on the next animation frame.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    signal?.throwIfAborted()
    if (!scalePointsOnZoom) {
      // Freeze the fitted size of the simulation's world-unit points in pixels.
      graph.setConfigPartial({ pointSizeScale: (definition.simulation?.pointSizeScale ?? 1) * graph.getZoomLevel() })
    }
    const query = new URLSearchParams(window.location.search)
    const zoomFactor = query.has('capture') && query.has('overview') ? 1 : definition.initialZoomFactor ?? 1
    if (zoomFactor !== 1) {
      graph.setZoomLevel(graph.getZoomLevel() * zoomFactor, 0, false)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      signal?.throwIfAborted()
    }
    if (updateColors()) graph.render(undefined, 0)
    graph.renderOneFrame()
  } catch (error) {
    graph.destroy()
    throw error
  } finally {
    signal?.removeEventListener('abort', abortInitialization)
  }

  const sync = (): void => {
    if (destroyed) return
    const visible = onscreen && !document.hidden
    // A paused but visible scene still needs frames for camera interactions.
    if (graph.config.enableRenderLoop !== visible) graph.setConfigPartial({ enableRenderLoop: visible })
    if (paused || !visible) graph.pause()
    else if (graph.progress >= 1) graph.start(0.35)
    else graph.unpause()
  }
  const preferenceChanged = (): void => {
    paused = still || reducedMotion.matches
    sync()
  }
  const intersectionObserver = new IntersectionObserver(entries => {
    onscreen = entries[0]?.isIntersecting ?? false
    sync()
  })
  const resizeObserver = data.clusterLabels ? new ResizeObserver(refresh) : undefined
  const controls: SceneControls = {
    setPaused: (value): void => {
      paused = value
      sync()
      if (paused) clusterLabels?.draw(false)
    },
    fitView: (): void => { graph.fitView(reducedMotion.matches ? 0 : 400, FIT_PADDING, false) },
    zoomIn: (): void => { graph.setZoomLevel(graph.getZoomLevel() * 1.5, reducedMotion.matches ? 0 : 200, false) },
    zoomOut: (): void => { graph.setZoomLevel(graph.getZoomLevel() / 1.5, reducedMotion.matches ? 0 : 200, false) },
    destroy: (): void => {
      if (destroyed) return
      destroyed = true
      cancelAnimationFrame(frame)
      intersectionObserver.disconnect()
      resizeObserver?.disconnect()
      document.removeEventListener('visibilitychange', sync)
      reducedMotion.removeEventListener('change', preferenceChanged)
      signal?.removeEventListener('abort', controls.destroy)
      tooltip.remove()
      clusterLabels?.destroy()
      graph.destroy()
    },
  }
  if (signal?.aborted || !container.isConnected) {
    controls.destroy()
    return controls
  }
  if (data.clusterLabels) {
    clusterLabels = createClusterLabels(container, graph, data.clusterLabels)
    clusterLabels.draw(false)
    resizeObserver?.observe(container)
  }
  container.appendChild(tooltip)
  initialized = true
  intersectionObserver.observe(container)
  document.addEventListener('visibilitychange', sync)
  reducedMotion.addEventListener('change', preferenceChanged)
  signal?.addEventListener('abort', controls.destroy, { once: true })
  if (!paused && onscreen && !document.hidden) graph.start(0.35)
  sync()
  return controls
}
