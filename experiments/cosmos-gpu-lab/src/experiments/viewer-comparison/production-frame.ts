import type { Graph } from '../../../../../dist/index.js'
import { parseDiameter, parsePlacement } from '../production-points/fixture'
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
const engine = params.get('engine') === 'webgpu' ? 'webgpu' : 'webgl'
if (params.get('view') === 'public-graph') {
  const session = import('../production-graph-api/frame').then(module => module.mountGraph(host, engine))
  Object.assign(window, { publicGraph: session })
  // The parent subscribes after the frame loads, including when initialization failed early.
  session.catch(() => {})
} else if (params.get('view') === 'force-collision') {
  const fixture = params.get('fixture') === 'hashed' ? 'hashed' : 'contacts'
  const session = import('../production-force-collision/frame').then(module => module.mountCollision(host, engine, fixture))
  Object.assign(window, { forceCollision: session })
  session.catch(() => {})
} else if (params.get('view') === 'points') {
  const ratio = params.get('ratio') === '2' ? 2 : 1
  const placement = parsePlacement(params.get('placement'))
  const diameter = parseDiameter(params.get('diameter'), placement)
  const session = import('../production-points/frame').then(module => module.mountPoints(host, engine, ratio, diameter, placement))
  Object.assign(window, { pointsComparison: session })
  session.catch(() => {})
} else if (params.get('view') === 'large-comparison') {
  Object.assign(window, { createComparisonWebGL })
} else {
  Object.assign(window, { cosmosProduction: loadProductionBundle().then(() => createProduction(host)) })
}
