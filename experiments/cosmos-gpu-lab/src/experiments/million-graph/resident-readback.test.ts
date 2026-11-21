import { luma } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { CosmosLabels } from '../../../../../src/stories/points/labels/labels'
import { describeEnvironment } from '../../gpu/force-preview'
import { upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { cool } from '../combined-layout/data'
import { createIntegratedReadback, type TrackedSnapshot } from '../integrated-webgpu/readback'
import { nextFrame } from '../integrated-webgpu/runtime'
import { createResidentGraph } from '../many-body-grid/resident-graph'
import { selectedByReference, type Camera, type Pair, type Query } from '../selection/reference'
import { createInteractiveFixture } from './interactive-fixtures'
import { cameraFromView } from './resident-navigation'

const count = 1000000
const viewport = { width: 961, height: 541, pixelRatio: 2 }
const size = 5
const kinds = ['dense', 'hubs'] as const

for (const kind of kinds) {
  it.skipIf(import.meta.env.VITE_LAB_RESIDENT_READBACK !== '1')(`measures moving million-point ${kind} readback`, async () => {
    const scope = resourceScope()
    const host = document.createElement('div')
    host.dataset.residentStudy = 'true'
    host.style.position = 'relative'
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width * viewport.pixelRatio
    canvas.height = viewport.height * viewport.pixelRatio
    canvas.style.cssText = `display:block;width:${viewport.width}px;height:${viewport.height}px`
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'
    const selectionOutput = document.createElement('output')
    host.append(canvas, overlay, selectionOutput)
    canvas.dataset.canvas = 'true'
    document.body.append(host)
    const rows: unknown[] = []
    const record: Record<string, unknown> = {
      rows,
      kind,
      schedule: 'cache-poll',
      count,
      source: import.meta.env.LAB_SOURCE_REVISION,
      snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
      run: import.meta.env.LAB_RUN_ID,
      luma: luma.VERSION,
      status: 'started',
    }
    try {
      expect(record.source && record.snapshot && record.run).toBeTruthy()
      expect(document.visibilityState).toBe('visible')
      expect(navigator.userAgent).not.toContain('HeadlessChrome')
      expect(devicePixelRatio).toBe(viewport.pixelRatio)
      await commands.residentInput('layout')
      const fixture = createInteractiveFixture(count, kind)
      const stats = luma.stats.getStats('GPU Time and Memory').get('GPU Memory')
      const baseline = stats.count
      let peakBytes = 0
      const memory = (): void => { peakBytes = Math.max(peakBytes, stats.count - baseline) }
      const graph = scope.own(await createResidentGraph(canvas, fixture.input, fixture.graph, 'four-corners', {
        pixelRatio: viewport.pixelRatio, pointCulling: true, cachedHighlight: true,
      }))
      record.environment = describeEnvironment(graph.device, canvas)
      expect(graph.device.info.fallback).toBe(false)
      graph.fit()
      const camera = cameraFromView(await graph.readView(), viewport.height)
      const styleArray = new Float32Array(count * 8)
      for (let i = 0; i < count; i++) { styleArray[i * 8 + 3] = 1; styleArray[i * 8 + 4] = size }
      const styleSource = scope.own(upload(graph.device, styleArray))
      let tick = 0
      let alpha = 1
      const readback = scope.own(await createIntegratedReadback(
        () => graph.positionSource(), canvas, { camera, ratio: viewport.pixelRatio, styleSource }, () => tick, fixture.input.points
      ))
      const tracked = Array.from({ length: 1000 }, (_, i) => i === 1 ? 1 : i * 1000)
      const labels = new CosmosLabels(overlay, new Map(tracked.map(id => [id, `Point ${id}`])))
      const screen = ([x, y]: Pair): Pair => [viewport.width / 2 + (x - camera.x) * camera.zoom, viewport.height / 2 - (y - camera.y) * camera.zoom]
      const labelView = {
        spaceToScreenPosition: screen,
        spaceToScreenRadius: (radius: number): number => radius,
        getPointRadiusByIndex: (): number => size / 2,
      }
      const [x, y] = screen([3200, 0])
      const queries: [Query, Query] = [
        { rect: [[x - 24.5, y - 24.5], [x + 24.5, y + 24.5]] },
        { polygon: [[x - 40, y], [x - 10, y - 25], [x + 26, y - 15], [x + 20, y + 18], [x - 7, y + 12]] },
      ]
      readback.api.setTrackedIndices(tracked)
      for (let i = 0; i < 4; i++) {
        graph.frame(tick++, alpha)
        alpha = cool(alpha, 200)
        await waitForGpu(graph.device)
      }
      let lastLabel: TrackedSnapshot | null = null
      for (let i = 0; i < 8; i++) {
        await nextFrame()
        expect(document.visibilityState).toBe('visible')
        const tickStarted = performance.now()
        graph.frame(tick++, alpha)
        alpha = cool(alpha, 200)
        const started = performance.now()
        const query = queries[i % queries.length]
        const areaRequest = readback.api.selectArea(query)
        readback.moved()
        memory()
        const pollLabels = async (): Promise<{ snapshot: TrackedSnapshot | null; coordinatesMs: number }> => {
          const deadline = started + 2000
          let snapshot = readback.api.latestTrackedPositions()
          while (snapshot?.tick !== tick && performance.now() < deadline) {
            await nextFrame()
            snapshot = readback.api.latestTrackedPositions()
          }
          return { snapshot, coordinatesMs: performance.now() - started }
        }
        const drawLabels = async (): Promise<{
          coordinatesMs: number; labelCpuMs: number; labelMs: number; labelFromTickMs: number;
        }> => {
          const { snapshot, coordinatesMs } = await pollLabels()
          expect(snapshot?.tick).toBe(tick)
          expect(snapshot?.map.size).toBe(tracked.length - 1)
          lastLabel = snapshot
          const labelStarted = performance.now()
          labels.update(labelView, snapshot!.map)
          const labelCpuMs = performance.now() - labelStarted
          await nextFrame()
          const presented = performance.now()
          return { coordinatesMs, labelCpuMs, labelMs: presented - started, labelFromTickMs: presented - tickStarted }
        }
        const [result, label] = await Promise.all([areaRequest.then(area => {
          expect(area?.tick).toBe(tick)
          expect(area!.ids.length).toBeGreaterThan(0)
          selectionOutput.textContent = `${area!.ids.length.toLocaleString()} selected`
          return { selected: area!.ids.length, areaMs: performance.now() - started }
        }), drawLabels()])
        rows.push({ tick, shape: 'rect' in query ? 'rectangle' : 'polygon', ...result, ...label })
      }

      const positions = await graph.readPositions()
      const points = Array.from({ length: count }, (_, id) => ({
        world: [positions[id * 4], positions[id * 4 + 1]] as Pair, size, absent: positions[id * 4 + 3],
      }))
      const view: Camera = {
        viewport: [viewport.width, viewport.height],
        origin: [camera.x, camera.y],
        translation: [0, 0],
        zoom: camera.zoom,
        ratio: viewport.pixelRatio,
        sizeScale: 1,
        maxSize: 64,
        scaleOnZoom: false,
      }
      const areaChecks = []
      for (const query of queries) {
        const result = await readback.api.selectArea(query)
        const expected = selectedByReference(points, view, query)
        const actual = result?.ids ?? []
        const exact = actual.length === expected.length && actual.every((id, i) => id === expected[i])
        const referenceIds = new Set(expected); const actualIds = new Set(actual)
        const absent = expected.filter(id => !actualIds.has(id))
        const added = actual.filter(id => !referenceIds.has(id))
        const witnesses = (ids: number[]): unknown[] => ids.slice(0, 8).map(id => ({ id, ...points[id], screen: screen(points[id].world) }))
        areaChecks.push({
          query,
          exact,
          expected: expected.length,
          actual: actual.length,
          missed: absent.length,
          added: added.length,
          missedWitnesses: witnesses(absent),
          addedWitnesses: witnesses(added),
        })
      }
      record.areaChecks = areaChecks
      const coordinates = (await readback.api.readTrackedPositions())!.map
      expect([...coordinates].every(([id, pair]) => pair[0] === positions[id * 4] && pair[1] === positions[id * 4 + 1])).toBe(true)
      expect(coordinates.has(1)).toBe(false)
      expect(lastLabel).toMatchObject({ tick, map: coordinates })

      const pendingArea = readback.api.selectArea(queries[0])
      const pendingLabels = readback.api.readTrackedPositions()
      const absent = new Float32Array([0, 0, 0, 1])
      graph.patchPositions(0, absent)
      readback.patched(0, absent)
      expect(await Promise.all([pendingArea, pendingLabels])).toEqual([null, null])
      expect(readback.api.latestTrackedPositions()?.map.has(0)).toBe(false)
      const pendingTopology = readback.api.selectArea(queries[1])
      readback.beginReplacement()
      graph.updateLinks({ ...fixture.graph, links: fixture.graph.links.subarray(0, -2), weights: fixture.graph.weights.subarray(0, -1) })
      readback.endReplacement()
      expect(await pendingTopology).toBeNull()
      expect(graph.linkCount).toBe(count - 11)
      expect(readback.api.error).toBe('')
      record.labelCoordinatesExact = true
      record.replacementInvalidation = true
      record.peakBytes = peakBytes
      expect(areaChecks.every(check => check.exact), 'Expected the independent area selection IDs in order').toBe(true)
      record.status = 'complete'
    } catch (error) {
      record.status = 'failed'
      record.error = String(error)
      throw error
    } finally {
      scope.destroy(); host.remove()
      await writeArtifact(`resident-readback-${kind}`, record)
    }
  }, 120000)
}
