import { expect, it } from 'vitest'
import { CosmosLabels } from '../../../../../src/stories/points/labels/labels'
import { writeArtifact } from '../../testing/artifacts'
import { nextFrame } from '../integrated-webgpu/runtime'
import type { Production } from './production'

const viewport = [640, 400] as const
const rect: [[number, number], [number, number]] = [[235, 135], [405, 265]]
const lasso: Array<[number, number]> = [[220, 180], [390, 125], [435, 245], [320, 222], [255, 285]]

function grid (count: number): Float32Array {
  const side = Math.ceil(Math.sqrt(count))
  const data = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    data[2 * i] = 64 + i % side * 3968 / side
    data[2 * i + 1] = 64 + Math.floor(i / side) * 3968 / side
  }
  data.set([NaN, NaN])
  return data
}

for (const [count, moving] of [[16384, true], [1000000, false]] as const) {
  it.skipIf(import.meta.env.VITE_LAB_GRAPH_READBACK !== '1')(`times real Graph selection and tracked labels at ${count} points`, async () => {
    const rows: Array<{ area: string; selected: number; readMs: number; highlightMs: number; gatherMs: number; labelsMs: number }> = []
    const record: Record<string, unknown> = {
      rows,
      count,
      moving,
      source: import.meta.env.LAB_SOURCE_REVISION,
      snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
      run: import.meta.env.LAB_RUN_ID,
      productionSha256: import.meta.env.VITE_LAB_PRODUCTION_SHA256,
      status: 'started',
    }
    const host = document.createElement('div'); host.style.position = 'relative'
    const control = document.createElement('iframe'); control.title = 'Production Graph'
    control.style.cssText = `display:block;border:0;width:${viewport[0]}px;height:${viewport[1]}px`
    const overlay = document.createElement('div')
    overlay.style.cssText = `position:absolute;inset:0;overflow:hidden;width:${viewport[0]}px;height:${viewport[1]}px;pointer-events:none`
    const ready = new Promise<void>((resolve, reject) => {
      control.onload = (): void => resolve()
      control.onerror = (): void => reject(new Error('Production Graph failed to load'))
    })
    control.src = '/production-viewer.html'
    host.append(control, overlay)
    document.body.append(host)
    let gl: Production | undefined
    try {
      expect(record.source && record.snapshot && record.run && record.productionSha256).toBeTruthy()
      expect(document.visibilityState).toBe('visible')
      expect(navigator.userAgent).not.toContain('HeadlessChrome')
      await ready
      gl = await (control.contentWindow as Window & { cosmosProduction: Promise<Production> }).cosmosProduction
      const { graph } = gl
      const memory = graph.simulation.device!.statsManager.getStats('GPU Time and Memory').get('GPU Memory')
      const baseline = memory.count
      let peakBytes = 0
      const sampleMemory = (): void => { peakBytes = Math.max(peakBytes, memory.count - baseline) }
      record.environment = gl.info
      expect(gl.info).toContain('Apple M3')
      graph.setConfigPartial({
        enableSimulation: moving,
        pixelRatio: 2,
        pointDefaultSize: 2,
        simulationGravity: 0.08,
        simulationCenter: 0,
        simulationRepulsion: 0,
      })
      const positions = grid(count)
      const tracked = Array.from({ length: 1000 }, (_, i) => Math.floor(i * count / 1000))
      const labels = new CosmosLabels(overlay, new Map(tracked.map(id => [id, `Point ${id}`])))
      const started = performance.now()
      graph.setPointPositions(positions, true)
      graph.setLinks(new Float32Array())
      graph.setPointColors(new Float32Array())
      graph.setPointSizes(new Float32Array())
      graph.render(1, 0)
      const k = 360 / 4096
      graph.setViewTransform({ k, x: (viewport[0] - k * viewport[0]) / 2, y: (viewport[1] - k * viewport[1]) / 2 }, [...viewport])
      graph.trackPointPositionsByIndices(tracked)
      await gl.frame(false)
      await nextFrame()
      record.startupMs = performance.now() - started
      sampleMemory()

      for (let i = 0; i < 8; i++) {
        expect(document.visibilityState).toBe('visible')
        const useRect = i % 2 === 0
        const frame = moving ? gl.frame(true) : undefined
        const selectionStart = performance.now()
        const query = useRect ? graph.findPointsInRectAsync(rect) : graph.findPointsInPolygonAsync(lasso)
        sampleMemory()
        const ids = await query
        const readMs = performance.now() - selectionStart
        expect(ids?.length).toBeGreaterThan(0)
        await frame
        graph.setConfigPartial({ highlightedPointIndices: ids! })
        await gl.frame(false)
        await nextFrame()
        const highlightMs = performance.now() - selectionStart
        const expected = useRect ? graph.findPointsInRect(rect) : graph.findPointsInPolygon(lasso)
        expect(ids?.length).toBe(expected.length)
        expect(ids!.every((id, index) => id === expected[index])).toBe(true)

        const labelFrame = moving ? gl.frame(true) : undefined
        const labelStart = performance.now()
        const gather = graph.getTrackedPointPositionsMapAsync()
        sampleMemory()
        const coordinates = await gather
        const gatherMs = performance.now() - labelStart
        expect(coordinates?.size).toBe(tracked.length - 1)
        labels.update(graph, coordinates!)
        await nextFrame()
        const labelsMs = performance.now() - labelStart
        await labelFrame
        expect(coordinates).toEqual(graph.getTrackedPointPositionsMap())
        rows.push({ area: useRect ? 'rect' : 'lasso', selected: ids!.length, readMs, highlightMs, gatherMs, labelsMs })
      }

      const oldArea = graph.findPointsInRectAsync(rect)
      const oldLabels = graph.getTrackedPointPositionsMapAsync()
      const shrink = performance.now()
      graph.setPointPositions(positions.subarray(0, 256), true)
      graph.setLinks(new Float32Array([1, 2, 2, 4]))
      graph.render(undefined, 0)
      await gl.frame(false)
      await nextFrame()
      record.shrinkMs = performance.now() - shrink
      expect(await Promise.all([oldArea, oldLabels])).toEqual([null, null])
      expect([...(await graph.getTrackedPointPositionsMapAsync())!.keys()].every(id => id < 128)).toBe(true)
      const regrow = performance.now()
      graph.setPointPositions(positions, true)
      graph.setLinks(new Float32Array())
      graph.render(undefined, 0)
      await gl.frame(false)
      await nextFrame()
      record.regrowMs = performance.now() - regrow
      sampleMemory()
      expect((await graph.getTrackedPointPositionsMapAsync())?.size).toBe(tracked.length - 1)
      record.peakBytes = peakBytes
      record.tick = gl.tick
      if (moving) expect(gl.tick).toBeGreaterThan(0)
      record.status = 'complete'
    } catch (error) {
      record.error = String(error)
      record.status = 'failed'
      throw error
    } finally { gl?.destroy(); host.remove(); await writeArtifact(`production-graph-readback-${count}`, record) }
  }, 150000)
}
