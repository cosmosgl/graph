import { luma } from '@luma.gl/core'
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import { waitForGpu } from '../../../gpu/luma'
import { resourceScope } from '../../../gpu/resource-scope'
import { ALPHA_MIN, cool } from '../../combined-layout/data'
import { createIntegratedReadback } from '../../integrated-webgpu/readback'
import { createRenderer } from '../../integrated-webgpu/renderer'
import { createResidentGraph } from '../../many-body-grid/resident-graph'
import { createResidentFrameLoop } from '../../million-graph/frame-loop'
import type { Pair } from '../../selection/reference'
import type { CreateAdapter, Tracked } from './adapter'
import { viewport } from './fixture'

export const createAdapter: CreateAdapter = async (host, fixture, observer, picked) => {
  const scope = resourceScope()
  const canvas = document.createElement('canvas')
  const ratio = viewport.pixelRatio
  canvas.width = viewport.width * ratio
  canvas.height = viewport.height * ratio
  host.append(canvas)
  const memory = luma.stats.getStats('GPU Time and Memory').get('GPU Memory')
  let peakBytes = memory.count
  const sampleMemory = (): void => { peakBytes = Math.max(peakBytes, memory.count) }
  try {
    const { scene, replacement } = fixture
    const graph = scope.own(await createResidentGraph(canvas, scene.input, scene.graph, 'four-corners', {
      pixelRatio: ratio, externalDraw: true, productionForceDefaults: true,
    }))
    const drawing = scope.own(createRenderer(() => graph.positionSource(), scene.graph, canvas, {
      smoothLinks: true,
      linkDistanceOpacity: { range: [50, 150], minimum: 0.25 },
      background: [34 / 255, 34 / 255, 34 / 255, 1],
      defaultPoint: { color: [179 / 255, 179 / 255, 179 / 255, 1], size: fixture.size },
    }))
    drawing.ratio = ratio
    drawing.setLinkStyle([0.4, 0.4, 0.4, 1], 1)
    let tick = 0
    let alpha = 1
    let running = false
    let dirty = true
    let inGesture = false
    let destroyed = false
    let error = ''
    const readback = scope.own(await createIntegratedReadback(() => graph.positionSource(), canvas, drawing, () => tick, scene.input.points))
    const loop = createResidentFrameLoop({
      wantsFrame: () => !destroyed && !error && (dirty || running || inGesture),
      async frame (): Promise<void> {
        try {
          if (running && !inGesture) {
            graph.frame(tick++, alpha, false)
            alpha = cool(alpha, 5000)
            if (alpha < ALPHA_MIN) running = false
          }
          const renderedTick = tick
          dirty = false
          drawing.draw()
          sampleMemory()
          await waitForGpu(graph.device, 20000)
          if (!destroyed) observer.submitted(renderedTick)
        } catch (cause) { if (!destroyed) error = String(cause) }
      },
    })
    const redraw = (): void => { dirty = true; loop.request() }
    const navigation = zoom<HTMLCanvasElement, undefined>().scaleExtent([1e-6, Infinity])
      .on('start', () => { inGesture = true; loop.request() })
      .on('zoom', ({ transform: { x, y, k } }) => {
        const w = canvas.width / ratio; const h = canvas.height / ratio
        drawing.camera = { x: (w / 2 - x) / k - w / 2, y: (y - h / 2) / k + h / 2, zoom: k }
        redraw()
      })
      .on('end', () => { inGesture = false; loop.request() })
    const controls = select<HTMLCanvasElement, undefined>(canvas).call(navigation)
    const setCamera = (): void => {
      const k = fixture.zoom
      controls.call(navigation.transform, zoomIdentity.translate(canvas.width / ratio * (1 - k) / 2, canvas.height / ratio * (1 - k) / 2).scale(k))
    }
    setCamera()
    const abort = new AbortController()
    canvas.addEventListener('click', event => {
      const bounds = canvas.getBoundingClientRect()
      const read = drawing.pick((event.clientX - bounds.left) * ratio, (event.clientY - bounds.top) * ratio)
      sampleMemory()
      read.then(id => { if (!destroyed) picked(id, event) }).catch(cause => { if (!destroyed) error = String(cause) })
    }, { signal: abort.signal })
    loop.request()
    return {
      canvas,
      info: { ...graph.device.info },
      get peakBytes (): number { return peakBytes },
      get tick (): number { return tick },
      get error (): string { return error || (graph.device.isLost ? 'WebGPU device lost' : '') },
      run (): void { running = true; loop.request() },
      pause (): void { running = false },
      track: indices => readback.api.setTrackedIndices(indices),
      async tracked (): Promise<Tracked | null> {
        const result = readback.api.readTrackedPositions()
        sampleMemory()
        return (await result)?.map ?? null
      },
      async select (query): Promise<number[] | null> {
        const result = readback.api.selectArea(query)
        sampleMemory()
        return (await result)?.ids ?? null
      },
      spaceToScreenPosition ([x, y]): Pair {
        const camera = drawing.camera
        return [canvas.width / ratio / 2 + (x - camera.x) * camera.zoom, canvas.height / ratio / 2 - (y - camera.y) * camera.zoom]
      },
      screenToWorld ([x, y]): Pair {
        const camera = drawing.camera
        return [camera.x + (x - canvas.width / ratio / 2) / camera.zoom, camera.y - (y - canvas.height / ratio / 2) / camera.zoom]
      },
      spaceToScreenRadius: radius => radius,
      getPointRadiusByIndex: () => fixture.size / 2,
      positionUpdate (id, [x, y], pin): void {
        graph.patchPositions(id, new Float32Array([x, y, pin ? 1 : scene.input.points[id * 4 + 2], scene.input.points[id * 4 + 3]]))
        redraw()
      },
      topologyUpdate (): void {
        graph.updateLinks(replacement.graph)
        drawing.setLinks(replacement.graph.links)
        redraw()
      },
      replace (): void {
        graph.patchPositions(0, replacement.input.points)
        graph.updateLinks(scene.graph)
        drawing.setLinks(scene.graph.links)
        readback.beginReplacement()
        readback.endReplacement(replacement.input.points)
        alpha = 1
        redraw()
      },
      resize (width, height): void {
        canvas.width = width * ratio
        canvas.height = height * ratio
        graph.device.canvasContext!.resize({ width: canvas.width, height: canvas.height })
        setCamera()
      },
      positions: async () => await graph.readPositions(),
      destroy (): void {
        destroyed = true; abort.abort(); loop.cancel(); controls.on('.zoom', null); scope.destroy(); canvas.remove()
      },
    }
  } catch (cause) { scope.destroy(); canvas.remove(); throw cause }
}
