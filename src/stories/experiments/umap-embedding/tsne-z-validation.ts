import { Graph, type GraphConfig } from '@cosmos.gl/graph'

import { buildKnn, buildTsneGraph } from './data-gen'
import { loadMammoth, kmeansLabels, labelColors, coordInit2D } from './mammoth-data'

/**
 * Numerical validation of the t-SNE kernel's GPU-computed global normalization:
 * runs the t-SNE simulation on a small mammoth subsample and, once a second,
 * compares the GPU Z (read back via `graph.getTsneNormalization()`) against the
 * exact CPU sum Z = Σ_{k≠l} 1/(1 + d²) over all pairs of the current positions.
 *
 * The GPU value is a Barnes-Hut approximation (per-cell centroids, plus the
 * own-cell centroid standing in for the self term) and lags the CPU read by up
 * to one simulation tick, so a few percent of relative error is expected —
 * a WRONG reduction would be off by orders of magnitude, not percent.
 */
export const tsneZValidation = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.cssText = 'height: 100vh; width: 100%; position: relative;'

  const graphDiv = document.createElement('div')
  graphDiv.style.cssText = 'position: absolute; inset: 0;'
  div.appendChild(graphDiv)

  const readout = document.createElement('div')
  readout.style.cssText = [
    'position: absolute', 'top: 12px', 'left: 12px', 'z-index: 1000', 'padding: 10px 12px',
    'font: 500 12px/1.6 Menlo, monospace', 'color: #cdd3e0',
    'background: rgba(11,14,26,0.7)', 'border-radius: 8px', 'white-space: pre',
  ].join(';')
  readout.textContent = 'measuring…'
  div.appendChild(readout)

  // Every 12th mammoth point: real structure, small enough for the exact O(n²)
  // CPU sum to be instant.
  const full = loadMammoth()
  const n = Math.floor(full.n / 12)
  const vectors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 3; d++) vectors[i * 3 + d] = full.vectors[i * 12 * 3 + d] as number
  }
  const labels = kmeansLabels(vectors, n, 9)

  const perplexity = 15
  const k = 3 * perplexity
  const knn = buildKnn(vectors, 3, k)
  const { links, strengths } = buildTsneGraph(knn, n, k, perplexity)

  const spaceSize = 4096
  const umapScale = 40

  const config: GraphConfig = {
    spaceSize,
    backgroundColor: '#0b0e1a',
    pointDefaultSize: 4,
    scalePointsOnZoom: true,
    renderLinks: false,
    enableSimulation: true,
    simulationKernel: 'tsne',
    simulationUmapScale: umapScale,
    simulationLinkSpring: 1,
    simulationRepulsion: 0.5,
    simulationGravity: 0.05,
    simulationCenter: 0.1,
    simulationDecay: 5000,
    fitViewOnInit: true,
    fitViewDelay: 3000,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(graphDiv, config)

  graph.setPointPositions(coordInit2D(vectors, n, spaceSize))
  graph.setPointColors(labelColors(labels))
  graph.setLinks(links)
  graph.setLinkStrength(strengths)
  graph.render()

  /** Exact Z = Σ_{k≠l} 1/(1 + d²) over the current 2D positions, in embedding units. */
  const cpuZ = (): number | undefined => {
    const positions = graph.getPointPositions()
    if (positions.length < 4) return undefined
    const count = positions.length / 2
    let sum = 0
    for (let i = 0; i < count; i++) {
      const xi = positions[i * 2] as number
      const yi = positions[i * 2 + 1] as number
      for (let j = i + 1; j < count; j++) {
        const dx = (xi - (positions[j * 2] as number)) / umapScale
        const dy = (yi - (positions[j * 2 + 1] as number)) / umapScale
        sum += 1 / (1 + dx * dx + dy * dy)
      }
    }
    return 2 * sum // ordered pairs
  }

  const history: string[] = []
  const timer = setInterval(() => {
    const gpu = graph.getTsneNormalization()
    const cpu = cpuZ()
    if (gpu === undefined || cpu === undefined || cpu === 0) return
    const errorPercent = (Math.abs(gpu - cpu) / cpu) * 100
    history.push(`GPU Z ${gpu.toExponential(3)}   CPU Z ${cpu.toExponential(3)}   err ${errorPercent.toFixed(2)}%`)
    if (history.length > 10) history.shift()
    readout.textContent = `t-SNE global normalization: GPU reduction vs exact CPU sum (n = ${n})\n${history.join('\n')}`
  }, 1000)

  const destroy = (): void => {
    clearInterval(timer)
    graph.destroy()
  }

  return { div, graph, destroy }
}
