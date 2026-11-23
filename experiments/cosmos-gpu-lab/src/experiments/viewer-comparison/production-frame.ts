import type { Graph } from '../../../../../dist/index.js'
import { applyComparisonInput, seed, type ComparisonInput } from './comparison-input'
import { createProduction } from './production'
import { loadProductionBundle } from './production-bundle'

export type CreateComparisonWebGL = (
  input: ComparisonInput, pixelRatio: number, callbacks: {
    tick(): void;
    frameSubmitted?(completion: Promise<void>): void;
    ended(): void;
    lost(): void;
  }
) => Promise<Graph>

async function completedFrame (graph: Graph): Promise<void> {
  // The simulation callback runs before Graph draws. Place the fence after
  // the rest of that frame has submitted on the same device.
  await Promise.resolve()
  const fence = graph.simulation.device!.createFence()
  try { await fence.signaled } finally { fence.destroy() }
}

const host = document.querySelector<HTMLDivElement>('#graph')!
const createComparisonWebGL: CreateComparisonWebGL = async (input, pixelRatio, { tick, frameSubmitted, ended, lost }) => {
  const GRAPH = await loadProductionBundle()
  const graph = new GRAPH(host, {
    fitViewOnInit: false,
    rescalePositions: false,
    pixelRatio,
    randomSeed: seed,
    pointDefaultSize: input.size,
    onSimulationTick (): void {
      tick()
      frameSubmitted?.(completedFrame(graph))
    },
    onSimulationEnd: ended,
  })
  try {
    await graph.ready
    host.querySelector('canvas')!.addEventListener('webglcontextlost', lost, { once: true })
    applyComparisonInput(graph, input)
    graph.render(1, 0)
    return graph
  } catch (error) { graph.destroy(); throw error }
}

const params = new URLSearchParams(window.location.search)
if (params.get('view') === 'public-graph') {
  const engine = params.get('engine') === 'webgpu' ? 'webgpu' : 'webgl'
  const session = import('../production-graph-api/frame').then(module => module.mountGraph(host, engine))
  Object.assign(window, { publicGraph: session })
  // The parent subscribes after the frame loads, including when initialization failed early.
  session.catch(() => {})
} else if (params.get('view') === 'large-comparison') {
  Object.assign(window, { createComparisonWebGL })
} else {
  Object.assign(window, { cosmosProduction: loadProductionBundle().then(() => createProduction(host)) })
}
