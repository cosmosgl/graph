import { expect, it } from 'vitest'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'

it.each(['webgl', 'webgpu'] as const)('returns empty geometry and view data after destroying the %s Graph', async engine => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  try {
    const GRAPH = await loadGraphPackage(engine, frame.contentDocument!)
    const graph = new GRAPH(null, { rescalePositions: true })
    try {
      await graph.ready
      graph.setPointPositions(Float32Array.of(1000, 1000, 1100, 1000))
      graph.setLinks(Float32Array.of(0, 1))
      graph.render(1, 0)
      graph.step()
      expect(graph.progress).toBeGreaterThan(0)
      expect(graph.getConnectedLinkIndices([0, 1])).toEqual([0])
      expect(graph.getPointColors().length).toBe(8)
    } finally { graph.destroy() }
    expect([
      graph.progress, graph.simulation.progress, graph.maxPointSize,
      graph.getZoomLevel(), graph.spaceToScreenRadius(4),
    ]).toEqual([0, 0, 0, 0, 0])
    expect([graph.spaceToScreenPosition([2, 3]), graph.screenToSpacePosition([4, 5])]).toEqual([[0, 0], [0, 0]])
    expect([graph.getScaleX(), graph.getScaleY()]).toEqual([undefined, undefined])
    // A disposed graph may still be held by its host. Empty reads must finish
    // before inspecting the original arrays or allocating their former length.
    for (const channel of ['pointSizes', 'pointColors', 'linkWidths', 'linkColors', 'linkStyles']) {
      Object.defineProperty(graph.graph, channel, { get: () => { throw Error(`Read disposed ${channel}`) } })
    }
    for (const result of [graph.getPointColors(), graph.getPointSizes(), graph.getLinkColors(), graph.getLinkWidths(), graph.getLinkStyles()]) {
      expect(Object.prototype.toString.call(result)).toBe('[object Float32Array]')
      expect(result.length).toBe(0)
    }
    expect([graph.getNeighboringPointIndices(0), graph.getConnectedLinkIndices([0, 1]), graph.getConnectedPointIndices(0)]).toEqual([[], [], []])
    expect([graph.getPointRadiusByIndex(0), graph.getLinkWidthByIndex(0)]).toEqual([undefined, undefined])
    graph.fitViewByPointPositions(new Proxy([0, 0], { get: (): never => { throw Error('Copied a fit target after destroy') } }))
  } finally { frame.remove() }
})
