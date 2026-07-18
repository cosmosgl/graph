import { Graph, type GraphConfig } from '@cosmos.gl/graph'

import { buildUmapGraph } from '../umap-embedding/data-gen'
import { approximateKnn } from './nn-descent'
import { runPca } from './pca-client'

import embeddingsUrl from './data/embeddings.i8.bin?url'
import langUrl from './data/lang.u8.bin?url'
import starsUrl from './data/stars.f32.bin?url'

/**
 * GPU UMAP stress test — 100 000 GitHub repositories, from raw 256-dim LLM
 * embeddings, projected to 2D entirely in the browser:
 *
 *   1. PCA (client-side, in a Worker — see pca.ts) reduces the raw 256-dim int8
 *      embeddings to 64-dim and produces the 2D init,
 *   2. approximate k-NN (NN-Descent, pure JS, see nn-descent.ts) over the 64-dim
 *      embeddings builds the affinity graph,
 *   3. the GPU force simulation with `simulationKernel: 'umap'` optimizes the
 *      100k-point, ~1M-edge embedding — the part under stress.
 *
 * Points are colored by primary language and sized by stars. Watch the FPS
 * monitor to see where the optimizer strains. Everything runs client-side; only
 * the parquet → int8 conversion happens offline (browsers can't read 96MB parquet).
 */

const RAW_DIM = 256
const REDUCED_DIM = 64
const K = 15

// Index → color, matching the LANGS order in preprocess.py (last = "Other").
const LANGS = ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C', 'C#', 'Go', 'Rust', 'PHP', 'Ruby', 'Shell', 'HTML', 'Swift', 'Kotlin', 'Other']
const PALETTE: [number, number, number][] = [
  [0.24, 0.51, 0.78], // Python - blue
  [0.95, 0.83, 0.25], // JavaScript - yellow
  [0.18, 0.46, 0.71], // TypeScript - deep blue
  [0.86, 0.42, 0.19], // Java - orange
  [0.94, 0.34, 0.55], // C++ - pink
  [0.55, 0.55, 0.58], // C - grey
  [0.44, 0.28, 0.66], // C# - purple
  [0.29, 0.76, 0.86], // Go - cyan
  [0.78, 0.29, 0.19], // Rust - rust red
  [0.49, 0.45, 0.72], // PHP - indigo
  [0.78, 0.20, 0.22], // Ruby - red
  [0.42, 0.56, 0.30], // Shell - olive
  [0.90, 0.45, 0.32], // HTML - coral
  [0.96, 0.55, 0.24], // Swift - amber
  [0.62, 0.36, 0.71], // Kotlin - violet
  [0.30, 0.33, 0.39], // Other - dark grey
]

const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`)
  return res.arrayBuffer()
}

/** Aspect-preserving scale of the precomputed PCA-2D init into the center of the space. */
const scaleInit = (raw: Float32Array, n: number, spaceSize: number, fill = 0.7): Float32Array => {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const x = raw[i * 2] as number; const y = raw[i * 2 + 1] as number
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const extent = Math.max(maxX - minX, maxY - minY) || 1
  const scale = (fill * spaceSize) / extent
  const center = spaceSize / 2
  const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2
  const out = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    out[i * 2] = center + ((raw[i * 2] as number) - cx) * scale
    out[i * 2 + 1] = center + ((raw[i * 2 + 1] as number) - cy) * scale
  }
  return out
}

const langColors = (lang: Uint8Array, n: number): Float32Array => {
  const colors = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const c = PALETTE[(lang[i] as number) % PALETTE.length] as [number, number, number]
    colors[i * 4] = c[0]; colors[i * 4 + 1] = c[1]; colors[i * 4 + 2] = c[2]; colors[i * 4 + 3] = 1
  }
  return colors
}

const starSizes = (stars: Float32Array, n: number, minSize = 2, maxSize = 25): Float32Array => {
  let maxLog = 0
  for (let i = 0; i < n; i++) { const l = Math.log10((stars[i] as number) + 1); if (l > maxLog) maxLog = l }
  const sizes = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = Math.log10((stars[i] as number) + 1) / (maxLog || 1)
    sizes[i] = minSize + t * (maxSize - minSize)
  }
  return sizes
}

export const githubStressTest = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.cssText = 'height: 100vh; width: 100%; position: relative; background: #0b0e1a;'

  const graphDiv = document.createElement('div')
  graphDiv.style.cssText = 'position: absolute; inset: 0;'
  div.appendChild(graphDiv)

  // Progress overlay shown during load + CPU kNN, removed once the sim starts.
  const overlay = document.createElement('div')
  overlay.style.cssText = [
    'position: absolute', 'inset: 0', 'display: flex', 'align-items: center', 'justify-content: center',
    'color: #cdd3e0', 'font: 600 15px Helvetica, Arial, sans-serif', 'pointer-events: none', 'z-index: 10',
  ].join(';')
  overlay.textContent = 'Loading embeddings…'
  div.appendChild(overlay)

  const spaceSize = 8192

  const config: GraphConfig = {
    spaceSize,
    backgroundColor: '#0b0e1a',
    pointDefaultSize: 5,
    scalePointsOnZoom: true,
    renderLinks: false,
    enableDrag: false,
    enableSimulation: true,
    simulationKernel: 'umap',
    simulationUmapScale: 350,
    simulationUmapMinDist: 0.15,
    simulationUmapSpread: 5,
    // In UMAP mode repulsion reads as "negative samples per point" (the engine
    // normalizes by point count); held compact by a little gravity + centering.
    simulationRepulsion: 2,
    simulationLinkSpring: 0.5,
    simulationCollision: 1,
    simulationGravity: 0.02,
    simulationCenter: 0.1,
    simulationDecay: 30000,
    spaceDimensions: 3,
    pointSphereShading: true,
    pointDepthFade: 0.1,
    showFPSMonitor: true,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(graphDiv, config)

  // Pause / start control.
  const toggleButton = document.createElement('button')
  toggleButton.textContent = 'Pause'
  toggleButton.style.cssText = [
    'position: absolute', 'top: 12px', 'left: 12px', 'z-index: 1000', 'padding: 6px 16px',
    'font: 600 13px Helvetica, Arial, sans-serif', 'color: #fff', 'background: #5f69de',
    'border: none', 'border-radius: 15px', 'cursor: pointer', 'opacity: 0.9',
  ].join(';')
  toggleButton.style.display = 'none'
  toggleButton.addEventListener('click', () => {
    if (graph.isSimulationRunning) { graph.pause(); toggleButton.textContent = 'Start' } else { graph.unpause(); toggleButton.textContent = 'Pause' }
  })
  div.appendChild(toggleButton)

  // Language legend.
  const legend = document.createElement('div')
  legend.style.cssText = [
    'position: absolute', 'bottom: 12px', 'left: 12px', 'z-index: 1000', 'padding: 8px 10px',
    'display: grid', 'grid-template-columns: auto auto', 'gap: 2px 10px',
    'font: 500 11px Helvetica, Arial, sans-serif', 'color: #cdd3e0',
    'background: rgba(11,14,26,0.6)', 'border-radius: 8px',
  ].join(';')
  LANGS.forEach((name, i) => {
    const c = PALETTE[i] as [number, number, number]
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; align-items: center; gap: 5px;'
    const rgb = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`
    row.innerHTML = `<span style="width:9px;height:9px;border-radius:2px;background:${rgb}"></span>${name}`
    legend.appendChild(row)
  })
  div.appendChild(legend)

  let cancelled = false

  const run = async (): Promise<void> => {
    const [embBuf, langBuf, starsBuf] = await Promise.all([
      fetchBytes(embeddingsUrl), fetchBytes(langUrl), fetchBytes(starsUrl),
    ])
    if (cancelled) return
    const lang = new Uint8Array(langBuf)
    const n = lang.length
    const emb = new Int8Array(embBuf) // raw 256-dim int8
    const stars = new Float32Array(starsBuf)

    const setProgress = (phase: string, frac: number): void => { overlay.textContent = `${phase} — ${Math.round(frac * 100)}%` }

    // Client-side PCA (in a Worker): reduce 256 → 64 dims for the kNN, and get
    // the 2D init positions. Transfers the raw embeddings into the worker.
    const { reduced, init2d } = await runPca(emb, n, RAW_DIM, REDUCED_DIM, setProgress)
    if (cancelled) return

    const knn = await approximateKnn(reduced, n, REDUCED_DIM, { k: K, onProgress: setProgress })
    if (cancelled) return

    overlay.textContent = 'Building UMAP graph…'
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    const { links, strengths } = buildUmapGraph(knn, n, K)
    if (cancelled) return

    graph.setPointPositions(scaleInit(init2d, n, spaceSize))
    graph.setPointColors(langColors(lang, n))
    graph.setPointSizes(starSizes(stars, n))
    graph.setLinks(links)
    graph.setLinkStrength(strengths)
    graph.render()
    graph.start()
    graph.fitView(0)

    overlay.remove()
    toggleButton.style.display = 'block'
  }

  run().catch((error: unknown) => {
    overlay.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`
    console.error(error)
  })

  const destroy = (): void => {
    cancelled = true
    graph.destroy()
  }

  return { div, graph, destroy }
}
