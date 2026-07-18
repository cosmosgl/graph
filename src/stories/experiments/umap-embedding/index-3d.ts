import { Graph, type GraphConfig } from '@cosmos.gl/graph'

import { buildKnn, buildUmapGraph, pcaInit } from './data-gen'
import { loadCountries, hdiColors, populationSizes } from './countries-data'
import { attachPointLabels } from './labels'

/**
 * GPU UMAP prototype (3D) on real data: same country-indicators pipeline as the
 * 2D story, embedding into 3D through the orbit camera. At this point count the
 * 3D repulsion runs on the exact brute-force pass; larger datasets go through
 * the octree with the same UMAP kernel. Drag to rotate, scroll to zoom.
 */
export const umapEmbedding3d = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const graphDiv = document.createElement('div')
  graphDiv.style.cssText = 'position: absolute; inset: 0;'
  div.appendChild(graphDiv)

  // See the 2D story for what these control. nNeighbors is CPU-side (kNN graph);
  // minDist is engine-side (simulationUmapMinDist).
  const nNeighbors = 15
  const minDist = 0.1

  const data = loadCountries()
  const n = data.names.length

  const knn = buildKnn(data.vectors, data.dim, nNeighbors)
  const { links, strengths } = buildUmapGraph(knn, n, nNeighbors)

  const spaceSize = 4096
  const umapScale = 150

  const config: GraphConfig = {
    spaceDimensions: 3,
    spaceSize,
    backgroundColor: '#0b0e1a',
    pointSphereShading: true,
    pointDepthFade: 0.1,
    scalePointsOnZoom: true,
    renderLinks: false,
    enableSimulation: true,
    simulationKernel: 'umap',
    simulationUmapScale: umapScale,
    simulationUmapMinDist: minDist,
    // See the 2D story: from the PCA init the simulation only refines, so gentle
    // repulsion + light gravity/centering keep it compact and framed.
    simulationRepulsion: 2 / n,
    simulationLinkSpring: 1,
    simulationGravity: 0.05,
    simulationCenter: 0.1,
    simulationDecay: 5000,
    cameraFov: 55,
    fitViewOnInit: true,
    fitViewDelay: 4000,
    // Label sampling density: one labeled point per ~90px screen cell
    pointSamplingDistance: 90,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(graphDiv, config)

  // PCA init: project the 32-dim indicator vectors onto their top 3 principal
  // components so the simulation refines a coherent layout instead of untangling
  // a random hairball. See the 2D story.
  const positions = pcaInit(data.vectors, n, data.dim, 3, spaceSize)

  graph.setPointPositions(positions, { dimensions: 3 })
  graph.setPointColors(hdiColors(data.hdi))
  graph.setPointSizes(populationSizes(data.population))
  graph.setLinks(links)
  graph.setLinkStrength(strengths)
  graph.render()

  const detachLabels = attachPointLabels(graph, div, data.names, true)
  const destroy = (): void => {
    detachLabels()
    graph.destroy()
  }

  return { div, graph, destroy }
}
