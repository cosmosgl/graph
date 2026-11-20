import type { Graph } from '../../../../../dist/index.js'
import { applyComparisonInput, seed, type ComparisonInput } from './comparison-input'
import { createProduction } from './production'
import { loadProductionBundle } from './production-bundle'

export type CreateDenseWebGL = (input: ComparisonInput, pixelRatio: number, ended: () => void, lost: () => void) => Promise<Graph>

const host = document.querySelector<HTMLDivElement>('#graph')!
const createDenseWebGL: CreateDenseWebGL = async (input, pixelRatio, ended, lost) => {
  const GRAPH = await loadProductionBundle()
  const graph = new GRAPH(host, {
    fitViewOnInit: false,
    rescalePositions: false,
    pixelRatio,
    randomSeed: seed,
    pointDefaultSize: input.size,
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

if (new URLSearchParams(window.location.search).get('view') === 'dense-communities') {
  Object.assign(window, { createDenseWebGL })
} else {
  Object.assign(window, { cosmosProduction: loadProductionBundle().then(() => createProduction(host)) })
}
