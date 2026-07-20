import { Graph, type GraphConfig } from '@cosmos.gl/graph'

import { buildKnn, buildUmapGraph, buildTsneGraph, sliceKnnLists } from './data-gen'
import { loadMammoth, coordInit2D, kmeansLabels, labelColors } from './mammoth-data'
import referenceRaw from './benchmark-reference.json?raw'

/**
 * Embedding Quality Benchmark — the "is it real UMAP / t-SNE?" number.
 *
 * Runs the GPU kernels on the mammoth (the exact data benchmark-reference.py
 * feeds to umap-learn and openTSNE, with matched hyperparameters), lets each
 * settle for a fixed number of simulation ticks, and computes the SAME
 * embedding-quality metrics the reference script computes:
 *
 *   - knn recall@k: fraction of each point's true k nearest neighbors in the
 *     3D input space preserved among its k nearest embedding neighbors,
 *   - trustworthiness@10 (Venna & Kaski) on a 2000-query sample.
 *
 * The PCA-init row doubles as a parity check: the reference script scores the
 * same PCA-2D projection, and rank-based metrics are scale-invariant, so the
 * two implementations must agree there (up to query-sampling noise in
 * trustworthiness).
 */

const UMAP_K = 25
const UMAP_MIN_DIST = 0.1
const TSNE_PERPLEXITY = 20
const TSNE_K = 3 * TSNE_PERPLEXITY
const TRUST_K = 10
const TRUST_SAMPLE = 2000
const SETTLE_TICKS = 1500
const EXAGGERATION_TICKS = 250

/** One row of benchmark-reference.json (keys include `recall@10`, `recall@30`). */
type ReferenceRow = Record<string, string | number>

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const nextTick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

export const embeddingBenchmark = async (): Promise<{ graph: Graph; div: HTMLDivElement; destroy?: () => void }> => {
  await nextTick() // let the "Loading story…" placeholder paint

  const div = document.createElement('div')
  div.style.cssText = 'height: 100vh; width: 100%; position: relative;'
  const graphDiv = document.createElement('div')
  graphDiv.style.cssText = 'position: absolute; inset: 0;'
  div.appendChild(graphDiv)

  const table = document.createElement('div')
  table.style.cssText = [
    'position: absolute', 'top: 12px', 'left: 12px', 'z-index: 1000', 'padding: 10px 12px',
    'font: 500 12px/1.7 Menlo, monospace', 'color: #cdd3e0',
    'background: rgba(11,14,26,0.75)', 'border-radius: 8px', 'white-space: pre',
  ].join(';')
  div.appendChild(table)

  const reference = JSON.parse(referenceRaw) as { results: ReferenceRow[] }
  const rows: string[] = []
  const renderTable = (status: string): void => {
    const header = 'embedding            recall@10  recall@30  trust@10'
    const referenceRows = reference.results.map((r) => [
      String(r.name).padEnd(20),
      String(r['recall@10']).padEnd(10),
      String(r['recall@30']).padEnd(10),
      `${String(r.trustworthiness)}  (reference, ${String(r.seconds)}s)`,
    ].join(' '))
    table.textContent = [header, ...referenceRows, ...rows, '', status].join('\n')
  }
  renderTable('loading mammoth…')

  const data = loadMammoth()
  const n = data.n
  const labels = kmeansLabels(data.vectors, n, 9)

  renderTable(`computing exact input kNN (k = ${TSNE_K}) — blocks the tab ~30s…`)
  await nextTick()
  const inputKnn = buildKnn(data.vectors, 3, TSNE_K)

  const spaceSize = 4096
  const init = coordInit2D(data.vectors, n, spaceSize)

  // ── Metrics (definitions mirror benchmark-reference.py) ────────────────────
  const embeddingKnn = (positions: Float32Array, k: number): Int32Array =>
    buildKnn(positions, 2, k).indices

  const recallAt = (embKnn: Int32Array, k: number): number => {
    let hits = 0
    for (let i = 0; i < n; i++) {
      const truth = new Set<number>()
      for (let s = 0; s < k; s++) truth.add(inputKnn.indices[i * TSNE_K + s] as number)
      for (let s = 0; s < k; s++) if (truth.has(embKnn[i * k + s] as number)) hits++
    }
    return hits / (n * k)
  }

  const trustworthiness = (embKnn10: Int32Array): number => {
    const rand = mulberry32(42)
    const queries = new Set<number>()
    while (queries.size < Math.min(TRUST_SAMPLE, n)) queries.add(Math.floor(rand() * n))
    const d2 = new Float32Array(n)
    let total = 0
    for (const q of queries) {
      const qx = data.vectors[q * 3] as number
      const qy = data.vectors[q * 3 + 1] as number
      const qz = data.vectors[q * 3 + 2] as number
      for (let i = 0; i < n; i++) {
        const dx = (data.vectors[i * 3] as number) - qx
        const dy = (data.vectors[i * 3 + 1] as number) - qy
        const dz = (data.vectors[i * 3 + 2] as number) - qz
        d2[i] = dx * dx + dy * dy + dz * dz
      }
      for (let s = 0; s < TRUST_K; s++) {
        const j = embKnn10[q * TRUST_K + s] as number
        // 1-based input-space rank of j among q's neighbors (self excluded).
        const dj = d2[j] as number
        let rank = 1
        for (let i = 0; i < n; i++) if (i !== q && i !== j && (d2[i] as number) < dj) rank++
        if (rank > TRUST_K) total += rank - TRUST_K
      }
    }
    const m = queries.size
    return 1 - (2 / (m * TRUST_K * (2 * n - 3 * TRUST_K - 1))) * total
  }

  const measure = async (name: string, positions: Float32Array, seconds: number): Promise<void> => {
    renderTable(`scoring ${name}…`)
    await nextTick()
    const embKnn30 = embeddingKnn(positions, 30)
    const embKnn10 = embeddingKnn(positions, TRUST_K)
    const r10 = recallAt(embKnn10, 10)
    const r30 = recallAt(embKnn30, 30)
    await nextTick()
    const trust = trustworthiness(embKnn10)
    rows.push(`${name.padEnd(20)} ${r10.toFixed(4).padEnd(10)} ${r30.toFixed(4).padEnd(10)} ${trust.toFixed(4)}  (GPU, ${seconds.toFixed(0)}s)`)
  }

  // ── Graph + simulation ─────────────────────────────────────────────────────
  const config: GraphConfig = {
    spaceSize,
    backgroundColor: '#0b0e1a',
    pointDefaultSize: 3,
    scalePointsOnZoom: true,
    renderLinks: false,
    enableSimulation: true,
    simulationKernel: 'umap',
    simulationUmapScale: 120,
    simulationUmapMinDist: UMAP_MIN_DIST,
    simulationLinkSpring: 1,
    simulationRepulsion: 0.5,
    simulationGravity: 0.05,
    simulationCenter: 0.1,
    simulationDecay: 3000,
    fitViewOnInit: true,
    fitViewDelay: 4000,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  let ticks = 0
  let onSettled: (() => void) | undefined
  let exaggerationEndTick = -1
  config.onSimulationTick = (): void => {
    ticks += 1
    if (exaggerationEndTick > 0 && ticks === exaggerationEndTick) {
      graph.setConfigPartial({ simulationLinkSpring: 1 })
    }
    if (ticks >= SETTLE_TICKS && onSettled) {
      const done = onSettled
      onSettled = undefined
      graph.pause()
      done()
    }
  }
  const settle = (): Promise<void> => new Promise((resolve) => { ticks = 0; onSettled = resolve })

  const graph = new Graph(graphDiv, config)
  graph.setPointPositions(init)
  graph.setPointColors(labelColors(labels))
  graph.render()

  const positionsNow = (): Float32Array => Float32Array.from(graph.getPointPositions())

  let cancelled = false
  const run = async (): Promise<void> => {
    // Parity check row: score the PCA init itself (matches the reference
    // script's PCA-2D row up to trustworthiness sampling noise).
    await measure('PCA-2D (JS parity)', init, 0)
    if (cancelled) return

    // UMAP run.
    renderTable('building UMAP graph…')
    await nextTick()
    const umapGraph = buildUmapGraph(sliceKnnLists(inputKnn, n, TSNE_K, UMAP_K), n, UMAP_K)
    graph.setLinks(umapGraph.links)
    graph.setLinkStrength(umapGraph.strengths)
    graph.render()
    const settledUmap = settle()
    const t0 = performance.now()
    renderTable(`UMAP settling (${SETTLE_TICKS} ticks)…`)
    graph.start()
    await settledUmap
    if (cancelled) return
    await measure('cosmos UMAP', positionsNow(), (performance.now() - t0) / 1000)
    if (cancelled) return

    // t-SNE run — fresh PCA init (openTSNE also starts from PCA).
    renderTable('calibrating t-SNE perplexity…')
    await nextTick()
    const tsneGraph = buildTsneGraph(inputKnn, n, TSNE_K, TSNE_PERPLEXITY)
    graph.setConfigPartial({
      simulationKernel: 'tsne',
      simulationUmapScale: 40,
      simulationLinkSpring: 12, // early exaggeration
      simulationRepulsion: 0.5,
    })
    graph.setPointPositions(init)
    graph.setLinks(tsneGraph.links)
    graph.setLinkStrength(tsneGraph.strengths)
    graph.render()
    const settledTsne = settle()
    exaggerationEndTick = EXAGGERATION_TICKS
    const t1 = performance.now()
    renderTable(`t-SNE settling (${SETTLE_TICKS} ticks, exaggeration for ${EXAGGERATION_TICKS})…`)
    graph.start()
    await settledTsne
    if (cancelled) return
    await measure('cosmos t-SNE', positionsNow(), (performance.now() - t1) / 1000)

    renderTable('done')
    graph.fitView(500)
  }

  run().catch((error: unknown) => {
    renderTable(`failed: ${error instanceof Error ? error.message : String(error)}`)
    console.error(error)
  })

  const destroy = (): void => {
    cancelled = true
    graph.destroy()
  }

  return { div, graph, destroy }
}
