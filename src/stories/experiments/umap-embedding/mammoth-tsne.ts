import { Graph, type GraphConfig } from '@cosmos.gl/graph'

import { buildKnn, buildTsneGraph } from './data-gen'
import { loadMammoth, kmeansLabels, labelColors, coordInit2D } from './mammoth-data'

/**
 * 2D Mammoth Projection, t-SNE edition: the same 10 000-point skeleton as the
 * UMAP mammoth story, embedded with `simulationKernel: 'tsne'` — Barnes-Hut
 * t-SNE's gradients on the GPU, including the global normalization term Z
 * computed each tick by a reduction over the repulsion pass's partial sums.
 *
 * The input p_ij come from perplexity calibration on the CPU (buildTsneGraph,
 * k = 3 · perplexity as in Barnes-Hut t-SNE). The engine drives the reference
 * schedule — early exaggeration for `simulationTsneExaggerationIterations` ticks,
 * then a clean optimizer state — and integrates with momentum + per-point gains.
 */
export const mammothTsneProjection = async (): Promise<{ graph: Graph; div: HTMLDivElement; destroy?: () => void }> => {
  // Yield once so the "Loading story…" placeholder paints before the synchronous
  // kNN build below blocks the main thread.
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })

  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  const perplexity = 20
  const nNeighbors = 3 * perplexity

  const data = loadMammoth()
  const n = data.n
  const labels = kmeansLabels(data.vectors, n, 9)

  const knn = buildKnn(data.vectors, 3, nNeighbors)
  const { links, strengths } = buildTsneGraph(knn, n, nNeighbors, perplexity)

  const spaceSize = 4096
  // t-SNE embeddings span far more embedding units than UMAP's (no min_dist
  // plateau), so the unit scale is smaller to keep the layout inside the space.
  const umapScale = 40

  const config: GraphConfig = {
    spaceSize,
    backgroundColor: '#0b0e1a',
    pointDefaultSize: 5,
    scalePointsOnZoom: true,
    renderLinks: false,
    enableSimulation: true,
    simulationKernel: 'tsne',
    simulationUmapScale: umapScale,
    simulationLinkSpring: 1,
    simulationRepulsion: 1,
    // The engine owns the t-SNE schedule: 12× attraction while the global
    // structure forms, then a clean optimizer state and a momentum ramp-up.
    simulationTsneExaggeration: 12,
    simulationTsneExaggerationIterations: 250,
    // Light gravity + centering keep the layout compact and framed under the
    // default `friction` integrator (positions are hard-clamped to the space).
    simulationGravity: 0.05,
    simulationCenter: 0.1,
    simulationDecay: 5000,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(div, config)

  // PCA-style init (project onto the two highest-variance 3D axes) so the
  // simulation refines a coherent silhouette instead of untangling a hairball.
  const positions = coordInit2D(data.vectors, n, spaceSize)

  graph.setPointPositions(positions)
  graph.setPointColors(labelColors(labels))
  graph.setLinks(links)
  graph.setLinkStrength(strengths)
  graph.render()

  // The layout expands as t-SNE spreads the clusters; re-fit periodically with
  // `enableSimulation: false` (reframes WITHOUT reheating), then stop so the
  // view is free to pan/zoom.
  let fits = 0
  const refitTimer = setInterval(() => {
    graph.fitView(600, 0.15, false)
    fits += 1
    if (fits >= 16) clearInterval(refitTimer)
  }, 2500)

  const destroy = (): void => {
    clearInterval(refitTimer)
    graph.destroy()
  }

  return { div, graph, destroy }
}
