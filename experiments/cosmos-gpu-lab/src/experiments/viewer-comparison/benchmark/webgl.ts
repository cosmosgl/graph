import { loadProductionBundle } from '../production-bundle'
import type { Pair } from '../../selection/reference'
import type { CreateAdapter, Tracked } from './adapter'
import { origin, seed, viewport } from './fixture'

export const productionBundleReady = loadProductionBundle()

export const createAdapter: CreateAdapter = async (host, fixture, observer, picked) => {
  let tick = 0
  let peakBytes = 0
  let error = ''
  let destroyed = false
  const GRAPH = await productionBundleReady
  const graph = new GRAPH(host, {
    fitViewOnInit: false,
    rescalePositions: false,
    pixelRatio: viewport.pixelRatio,
    randomSeed: seed,
    pointDefaultSize: fixture.size,
    onSimulationTick: (): void => { tick++ },
    onClick: (index, _position, event): void => picked(index ?? null, event),
  })
  try {
    await graph.ready
    const canvas = host.querySelector('canvas')!
    const device = graph.simulation.device!
    const memory = device.statsManager.getStats('GPU Time and Memory').get('GPU Memory')
    const sampleMemory = (): void => { peakBytes = Math.max(peakBytes, memory.count) }
    canvas.addEventListener('webglcontextlost', () => { error = 'Production WebGL context lost' })
    const draw = graph.drawToRenderPass.bind(graph)
    graph.drawToRenderPass = (...args): void => {
      draw(...args)
      const renderedTick = tick
      // Called by Graph's autonomous draw. Insert the marker after the normal
      // frame submitted without waiting for it in Graph's scheduler.
      queueMicrotask(() => {
        if (destroyed || error) return
        sampleMemory()
        try {
          const fence = device.createFence()
          let complete = false
          fence.signaled.then(() => { complete = true; fence.destroy() }).catch(cause => { error = String(cause) })
          observer.submitted(renderedTick, () => complete)
        } catch (cause) { error = String(cause) }
      })
    }
    const setCamera = (): void => {
      // Drive the real d3 camera so the next user pan continues from this view.
      graph.setZoomTransformByPointPositions(new Float32Array([origin, origin]), 0, fixture.zoom, 0)
    }
    const { positions, pinned } = fixture
    graph.pause()
    graph.setPointPositions(positions, true)
    graph.setPinnedPoints(pinned)
    graph.setLinks(fixture.scene.graph.links)
    graph.setLinkStrength(fixture.scene.graph.weights)
    setCamera()
    graph.render(1, 0)
    sampleMemory()
    return {
      canvas,
      info: { ...device.info },
      get peakBytes (): number { return peakBytes },
      get tick (): number { return tick },
      get error (): string { return error || (device.isLost ? 'Production WebGL device lost' : '') },
      run: () => graph.unpause(),
      pause: () => graph.pause(),
      track: indices => graph.trackPointPositionsByIndices(indices),
      async tracked (): Promise<Tracked | null> {
        const pending = graph.getTrackedPointPositionsMapAsync()
        sampleMemory()
        return await pending
      },
      async select (query): Promise<number[] | null> {
        const pending = 'rect' in query ? graph.findPointsInRectAsync(query.rect) : graph.findPointsInPolygonAsync(query.polygon)
        sampleMemory()
        return await pending
      },
      spaceToScreenPosition: point => graph.spaceToScreenPosition(point),
      screenToWorld (point): Pair {
        const [x, y] = graph.screenToSpacePosition(point)
        return [x - origin, y - origin]
      },
      spaceToScreenRadius: radius => graph.spaceToScreenRadius(radius),
      getPointRadiusByIndex: id => graph.getPointRadiusByIndex(id),
      positionUpdate (id, [x, y], pin): void {
        graph.setPointPosition(id, x + origin, y + origin)
        if (pin) graph.setPinnedPoint(id, true)
      },
      topologyUpdate (): void {
        graph.setLinks(fixture.replacement.graph.links)
        graph.setLinkStrength(fixture.replacement.graph.weights)
        graph.render(undefined, 0)
        sampleMemory()
      },
      replace (): void {
        graph.setPointPositions(fixture.replacementPositions, true)
        graph.setPinnedPoints(pinned)
        graph.setLinks(fixture.scene.graph.links)
        graph.setLinkStrength(fixture.scene.graph.weights)
        graph.render(1, 0)
        sampleMemory()
      },
      resize: setCamera,
      async positions (): Promise<Float32Array> {
        const source = await graph.getPointPositionsAsync()
        if (source.length !== positions.length) throw new Error('WebGL returned the wrong position count')
        const result = fixture.scene.input.points.slice()
        for (let i = 0; i < source.length / 2; i++) {
          const absent = Number.isNaN(source[i * 2]) && Number.isNaN(source[i * 2 + 1])
          if (!absent) { result[i * 4] = source[i * 2] - origin; result[i * 4 + 1] = source[i * 2 + 1] - origin }
          result[i * 4 + 2] = graph.isPointPinned(i) ? 1 : 0
          result[i * 4 + 3] = absent ? 1 : 0
        }
        return result
      },
      destroy (): void { destroyed = true; graph.destroy() },
    }
  } catch (cause) { graph.destroy(); throw cause }
}
