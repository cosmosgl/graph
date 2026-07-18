import { Graph, type GraphConfig } from '@cosmos.gl/graph'

import { buildKnn, buildUmapGraph, pcaInit } from './data-gen'
import { loadCountries, hdiColors, populationSizes } from './countries-data'
import { attachPointLabels } from './labels'

/**
 * GPU UMAP prototype (2D) on real data: ~190 countries described by ~30 numeric
 * development indicators (see countries-data.ts) are reduced to a kNN affinity
 * graph on the CPU, then the GPU force simulation with `simulationKernel: 'umap'`
 * optimizes the embedding — UMAP's attractive gradient runs over the links, its
 * repulsive gradient through the many-body force. Color encodes the human
 * development index (red → low, teal → high), point size the population, so a
 * converged embedding shows a development gradient with similar countries
 * grouped together.
 */
export const umapEmbedding = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const graphDiv = document.createElement('div')
  graphDiv.style.cssText = 'position: absolute; inset: 0;'
  div.appendChild(graphDiv)

  // ── UMAP parameters ──────────────────────────────────────────────────────
  // nNeighbors (UMAP's `n_neighbors`): size of the local neighborhood used to
  //   build the affinity graph. Smaller (~5) emphasizes fine local structure and
  //   fragments into more, tighter groups; larger (~30) preserves more global
  //   structure. CPU-side — changing it rebuilds the kNN graph below.
  // minDist (UMAP's `min_dist`): how tightly points may pack within a cluster.
  //   Smaller (→ 0) gives denser clumps; larger (→ 1) spreads points evenly.
  //   Engine-side — passed straight to the simulation via simulationUmapMinDist.
  const nNeighbors = 15
  const minDist = 0.1

  const data = loadCountries()
  const n = data.names.length

  const knn = buildKnn(data.vectors, data.dim, nNeighbors)
  const { links, strengths } = buildUmapGraph(knn, n, nNeighbors)

  const spaceSize = 4096
  const umapScale = 150

  const config: GraphConfig = {
    spaceSize,
    backgroundColor: '#0b0e1a',
    scalePointsOnZoom: true,
    renderLinks: false,
    enableSimulation: true,
    simulationKernel: 'umap',
    simulationUmapScale: umapScale,
    simulationUmapMinDist: minDist,
    simulationCollision: 0.5,
    // In UMAP mode repulsion reads as "negative samples per point" (the engine
    // normalizes by point count). From the PCA init the simulation only refines,
    // so a modest value spreads neighborhoods without re-inflating the layout.
    simulationRepulsion: 2,
    simulationLinkSpring: 1,
    simulationGravity: 0.05,
    simulationCenter: 0.1,
    simulationDecay: 5000,
    fitViewOnInit: true,
    fitViewDelay: 4000,
    // Label sampling density: one labeled point per ~90px screen cell
    pointSamplingDistance: 90,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(graphDiv, config)

  // PCA init: project the 32-dim indicator vectors onto their top 2 principal
  // components so the simulation refines a coherent layout instead of untangling
  // a random hairball (real UMAP uses a spectral/PCA init for the same reason).
  const positions = pcaInit(data.vectors, n, data.dim, 2, spaceSize)

  graph.setPointPositions(positions)
  graph.setPointColors(hdiColors(data.hdi))
  graph.setPointSizes(populationSizes(data.population))
  graph.setLinks(links)
  graph.setLinkStrength(strengths)
  graph.render()

  const detachLabels = attachPointLabels(graph, div, data.names, false)
  const destroy = (): void => {
    detachLabels()
    graph.destroy()
  }

  return { div, graph, destroy }
}
