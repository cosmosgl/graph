import type { Engine } from '../production-graph-api/frame'
import { origin } from './fixture'
import { createForcePreview, type ForceSession } from './frame'

type Phase = 'initial' | 'first' | 'edited' | 'pulled' | 'reweighted' | 'disabled' | 'resumed' | 'cleared'
type Snapshot = { xy: Float32Array; centroids: readonly number[] }
type EditRun = { device: ForceSession['device']; phases: Record<Phase, Snapshot> }

/** Observe both forces and their public centroid readback as a running graph's inputs change. */
export async function replayAttractionEdits (engine: Engine): Promise<EditRun> {
  const session = await createForcePreview(document.body, engine, 'clusters')
  const { graph } = session
  async function snapshot (step = false): Promise<Snapshot> {
    if (step) graph.step()
    const xy = await graph.getPointPositionsAsync()
    const centroids = 'getClusterPositionsAsync' in graph && typeof graph.getClusterPositionsAsync === 'function'
      ? await graph.getClusterPositionsAsync() as number[]
      : graph.getClusterPositions()
    return { xy, centroids }
  }
  try {
    const initial = await snapshot()
    const first = await snapshot(true)
    graph.setConfigPartial({ simulationCluster: 0.5, simulationAttractor: 0.25 })
    graph.setPointPosition(1, origin + 24, origin)
    graph.setPointClusters([3, 3, 1, 1, undefined, undefined, 3, undefined])
    graph.setClusterPositions([undefined, undefined, origin + 80, origin - 16])
    graph.setPointClusterStrength(Float32Array.of(1, 0.5, 1, 0, 0, 0, 1, 0))
    const targets = new Float32Array(16).fill(NaN)
    targets.set([origin + 64, origin - 32], 10)
    targets.set([origin - 40, origin + 16], 14)
    graph.setPointAttractors(targets)
    graph.setPointAttractorStrength(Float32Array.of(0, 0, 0, 0, 0, 0.5, 0, 0))
    graph.render(1, 0)
    graph.pause()
    const edited = await snapshot()
    const pulled = await snapshot(true)

    graph.setPointClusterStrength(Float32Array.of(0, 0, 1, 1, 0, 0, 0, 0))
    graph.setPointAttractorStrength(Float32Array.of(0, 0, 0, 0, 0, 0, 0, 1))
    graph.render(1, 0)
    graph.pause()
    const reweighted = await snapshot(true)
    graph.setConfigPartial({ enableSimulation: false })
    const disabled = await snapshot(true)
    graph.setConfigPartial({ enableSimulation: true })
    graph.pause()
    const resumed = await snapshot(true)
    graph.setPointClusters([])
    graph.setClusterPositions([])
    graph.setPointAttractors(new Float32Array(16).fill(NaN))
    graph.render(1, 0)
    graph.pause()
    const cleared = await snapshot(true)
    return { device: session.device, phases: { initial, first, edited, pulled, reweighted, disabled, resumed, cleared } }
  } finally { session.destroy() }
}
