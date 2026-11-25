import type { Graph } from '../../../../../dist/index.js'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import type { Engine } from '../production-graph-api/frame'
import { forceConfig } from './fixture'

type Edit = 'initial' | 'weighted' | 'zeroWeight' | 'replaced' | 'disabled' | 'reenabled' | 'resumed'

async function edit (graph: Graph): Promise<Record<Edit, Float32Array>> {
  async function step (): Promise<Float32Array> {
    graph.step()
    return await graph.getPointPositionsAsync()
  }
  graph.setPointPositions(Float32Array.of(2048, 2048, 2058, 2048, 2078, 2048), true)
  graph.setPinnedPoints([0])
  graph.setLinks(Float32Array.of(0, 1))
  graph.setLinkStrength(Float32Array.of(1))
  graph.render(1, 0)
  graph.pause()
  const initial = await graph.getPointPositionsAsync()
  const weighted = await step()

  graph.setLinkStrength(Float32Array.of(0))
  graph.render(1, 0)
  graph.pause()
  const zeroWeight = await step()

  graph.setLinks(Float32Array.of(1, 2))
  graph.setLinkStrength(Float32Array.of(0.75))
  graph.render(1, 0)
  graph.pause()
  const replaced = await step()

  graph.setConfigPartial({ enableSimulation: false })
  const disabled = await step()
  graph.setConfigPartial({ enableSimulation: true })
  graph.pause()
  const reenabled = await graph.getPointPositionsAsync()
  const resumed = await step()
  return { initial, weighted, zeroWeight, replaced, disabled, reenabled, resumed }
}

/** Replay edits through the public Graph with one pinned point and one initially unlinked point. */
export async function replaySpringEdits (engine: Engine): Promise<Record<Edit, Float32Array>> {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  try {
    const doc = frame.contentDocument!
    const GRAPH = await loadGraphPackage(engine, doc)
    const host = doc.createElement('div')
    host.style.cssText = 'position:relative;width:288px;height:192px'
    doc.body.append(host)
    const graph = new GRAPH(host, {
      ...forceConfig('springs'), simulationLinkDistance: 2, simulationLinkDistRandomVariationRange: [0.8, 1.2],
    })
    try {
      await graph.ready
      if (graph.simulation.device?.info.type !== engine) throw new Error(`Expected the ${engine} package`)
      return await edit(graph)
    } finally { graph.destroy() }
  } finally { frame.remove() }
}
