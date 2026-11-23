import { CosmosLabels } from '../../../../../src/stories/points/labels/labels'
import { loadYoutubeFixture } from '../million-graph/youtube-fixture'
import { applyComparisonInput, origin, prepareComparisonInput, seed } from '../viewer-comparison/comparison-input'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { viewport } from '../viewer-comparison/benchmark/fixture'
import type { Pair } from '../selection/reference'

const nextFrame = (): Promise<number> => new Promise(resolve => requestAnimationFrame(resolve))

type ReplaySession = {
  info: object; links: number; readonly tick: number;
  verify(value: boolean): void; result(): Promise<unknown> | undefined; destroy(): void;
}

// Called by the native replay script in a fresh migration-benchmark.html page.
export async function openYoutubeCheck (count: number): Promise<ReplaySession> {
  const graphHost = document.querySelector<HTMLDivElement>('#graph')!
  const surface = document.querySelector<HTMLDivElement>('#surface')!
  const labelHost = document.querySelector<HTMLDivElement>('#labels')!
  const feedback = document.querySelector<HTMLOutputElement>('#feedback')!
  const box = document.querySelector<HTMLDivElement>('#selection')!
  const scene = await loadYoutubeFixture(count)
  const input = prepareComparisonInput(scene, 2)
  const GRAPH = await loadGraphPackage('webgpu')
  let tick = 0
  const graph = new GRAPH(graphHost, {
    fitViewOnInit: false,
    rescalePositions: false,
    enableZoom: false,
    initialZoomLevel: 0.25,
    pixelRatio: viewport.pixelRatio,
    randomSeed: seed,
    pointDefaultSize: 2,
    onSimulationTick: (): void => { tick++ },
  })
  try {
    await graph.ready
    applyComparisonInput(graph, input)
    graph.render(1, 0)
    graph.setZoomTransformByPointPositions(new Float32Array([origin, origin]), 0, 0.25, 0)
    graph.unpause()
    const tracked = Array.from({ length: Math.min(1000, count) }, (_, i) => Math.floor(i * count / Math.min(1000, count)))
    const labels = new CosmosLabels(labelHost, new Map(tracked.map(id => [id, String(id)])))
    graph.trackPointPositionsByIndices(tracked)
    const selectionLayer = document.createElement('div')
    selectionLayer.style.cssText = 'position:absolute;inset:0;touch-action:none;cursor:crosshair'
    surface.append(selectionLayer)
    let start: Pair | undefined
    let pending: Promise<unknown> | undefined
    let verify = false
    const local = (event: PointerEvent): Pair => {
      const bounds = surface.getBoundingClientRect()
      return [event.clientX - bounds.left, event.clientY - bounds.top]
    }
    selectionLayer.onpointerdown = (event): void => {
      start = local(event)
      selectionLayer.setPointerCapture(event.pointerId)
    }
    selectionLayer.onpointerup = (event): void => {
      if (!start) return
      const end = local(event)
      const rect: [Pair, Pair] = [
        [Math.min(start[0], end[0]), Math.min(start[1], end[1])],
        [Math.max(start[0], end[0]), Math.max(start[1], end[1])],
      ]
      start = undefined
      const release = performance.now()
      const atRelease = tick
      const zoom = graph.getZoomLevel()
      const center = graph.spaceToScreenPosition([origin, origin])
      const ids = graph.findPointsInRectAsync(rect)
      const trackedPositions = graph.getTrackedPointPositionsMapAsync()
      const releasePositions = verify ? graph.getPointPositionsAsync() : undefined
      pending = (async (): Promise<object> => {
        const selected = await ids
        if (!selected) throw new Error('Moving rectangle selection returned null')
        const selectedMs = performance.now() - release
        graph.setConfigPartial({ highlightedPointIndices: selected })
        feedback.textContent = `${selected.length} selected`
        Object.assign(box.style, {
          left: `${rect[0][0]}px`,
          top: `${rect[0][1]}px`,
          width: `${rect[1][0] - rect[0][0]}px`,
          height: `${rect[1][1] - rect[0][1]}px`,
        })
        box.hidden = false
        const positions = await trackedPositions
        if (!positions) throw new Error('Moving position tracker returned null')
        labels.update(graph, positions)
        await nextFrame(); await nextFrame()
        const presentationMs = performance.now() - release
        let missing = 0; let extra = 0; let wrongLabels = 0
        const xy = await releasePositions
        if (xy) {
          const expected = new Set<number>()
          // Two-pixel points at zoom 0.25 use the default unscaled one CSS pixel radius.
          const [[left, top], [right, bottom]] = rect
          for (let id = 0; id < count; id++) {
            const x = center[0] + (xy[id * 2] - origin) * zoom
            const y = center[1] - (xy[id * 2 + 1] - origin) * zoom
            if (x + 1 >= left && x - 1 <= right && y + 1 >= top && y - 1 <= bottom) expected.add(id)
          }
          for (const id of selected) if (!expected.delete(id)) extra++
          missing = expected.size
          for (const id of tracked) {
            const actual = positions.get(id)
            if (!actual || actual[0] !== xy[id * 2] || actual[1] !== xy[id * 2 + 1]) wrongLabels++
          }
        }
        return {
          rect,
          center,
          zoom,
          selected: selected.length,
          labels: positions.size,
          ordered: selected.every((id, i) => i === 0 || selected[i - 1] < id),
          missing,
          extra,
          wrongLabels,
          verified: !!xy,
          tickAtRelease: atRelease,
          tickAfterFeedback: tick,
          selectedMs,
          presentationMs,
          trusted: event.isTrusted,
          visible: !document.hidden,
        }
      })()
      pending.catch(() => {})
    }
    return {
      info: graph.simulation.device!.info,
      links: scene.graph.links.length / 2,
      get tick (): number { return tick },
      verify (value: boolean): void { verify = value; pending = undefined },
      result (): Promise<unknown> | undefined { return pending },
      destroy (): void { graph.destroy() },
    }
  } catch (error) { graph.destroy(); throw error }
}
