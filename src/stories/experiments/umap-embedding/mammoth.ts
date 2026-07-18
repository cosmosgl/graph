import { Graph, type GraphConfig } from '@cosmos.gl/graph'

import { buildKnn, buildUmapGraph } from './data-gen'
import { loadMammoth, kmeansLabels, labelColors, coordInit2D } from './mammoth-data'

/**
 * 2D Mammoth Projection: the "understanding-umap" 3D woolly mammoth skeleton
 * (10 000 points) projected to 2D by the GPU UMAP simulation. The kNN affinity
 * graph is built on the CPU from the 3D coordinates (see data-gen.ts), then the
 * GPU force simulation with `simulationKernel: 'umap'` unrolls it into the plane.
 * Points are colored by anatomical region (k-means on the 3D positions), so you
 * can see body parts — legs, trunk, humps, head, tail — stay coherent as UMAP
 * flattens the skeleton. Mirrors the classic mammoth demo from
 * https://pair-code.github.io/understanding-umap/.
 *
 * Async because the O(n²) kNN over 10k points takes ~2s — the story shows a
 * loading state while it runs (see create-story.ts).
 */
export const mammothProjection = async (): Promise<{ graph: Graph; div: HTMLDivElement; destroy?: () => void }> => {
  // Yield once so the "Loading story…" placeholder paints before the synchronous
  // kNN build below blocks the main thread.
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })

  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  // ── UMAP parameters (see the country-embedding stories for what these do) ──
  // The reference mammoth demo uses n_neighbors = 50; we use fewer so the ~n·k
  // affinity graph stays light enough to converge quickly on the GPU.
  const nNeighbors = 50
  const minDist = 0.2

  const data = loadMammoth()
  const n = data.n
  const labels = kmeansLabels(data.vectors, n, 9)

  const knn = buildKnn(data.vectors, 3, nNeighbors)
  const { links, strengths } = buildUmapGraph(knn, n, nNeighbors)

  const spaceSize = 4096
  const umapScale = 120

  const config: GraphConfig = {
    spaceSize,
    backgroundColor: '#0b0e1a',
    pointDefaultSize: 5,
    scalePointsOnZoom: true,
    renderLinks: false,
    enableSimulation: true,
    simulationKernel: 'umap',
    simulationUmapScale: umapScale,
    simulationUmapMinDist: minDist,
    simulationCollision: 0.5,
    // From the PCA init (already a coherent silhouette) the simulation only needs
    // to LIGHTLY refine — unfold local structure while holding the overall shape.
    // Gentle repulsion + a little gravity keep it compact so it doesn't re-inflate
    // into a sparse cloud that fills (and clamps against) the space.
    simulationRepulsion: 0.5 / n,
    simulationLinkSpring: 1,
    simulationGravity: 0.05,
    simulationCenter: 0.1,
    simulationDecay: 3000,
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

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
