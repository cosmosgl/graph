import { Graph, type GraphConfig } from '@cosmos.gl/graph'

import { buildUmapGraph, buildTsneGraph, sliceKnnLists, type UmapGraph } from '../umap-embedding/data-gen'

import knnIdxUrl from './knn_idx.u16.bin?url'
import knnDistUrl from './knn_dist.f32.bin?url'
import initUrl from './init.f32.bin?url'
import init3dUrl from './init3d.f32.bin?url'
import precomputedUrl from './precomputed.f32.bin?url'
import topicUrl from './topic.i16.bin?url'
import supportsUrl from './supports.f32.bin?url'
import metaRaw from './meta.json?raw'

/**
 * Decidim Barcelona proposals — 31 775 citizen proposals, from 768-dim sentence
 * embeddings, laid out three ways for side-by-side comparison:
 *
 *   • UMAP        — the GPU `simulationKernel: 'umap'` optimizes the embedding,
 *   • t-SNE       — the GPU `simulationKernel: 'tsne'` optimizes the embedding,
 *   • Precomputed — the UMAP x/y that shipped in the dataset (reference).
 *
 * A 2D / 3D switch flips `spaceDimensions` live. In 3D the kernels optimize a
 * genuine 3D embedding (from a PCA-3D init, through the orbit camera and the
 * octree repulsion path at this point count) — not a projection of the 2D
 * result. The precomputed layout only ships x/y, so in 3D it stays a flat plane
 * at z = 0; that is the honest rendering of 2D data, and rotating it makes the
 * difference from a real 3D embedding obvious.
 *
 * The kNN graph and the PCA inits are precomputed offline (see preprocess.py)
 * — the browser can't read the parquet, and the thing under test here is the
 * GPU *layout* kernel, not kNN construction, so the layout-independent
 * preprocessing is done once. Switching mode or dimensionality restarts the
 * kernel from the matching PCA init, so every tab shows its algorithm's honest
 * from-scratch result against the precomputed reference.
 *
 * Points are colored by discovered topic (topic -1 is the generic
 * "neighborhood / project" bucket, ~40% of proposals, drawn dim grey) and sized
 * by support count.
 */

type Mode = 'umap' | 'tsne' | 'precomputed'

type Meta = {
  n: number;
  k: number;
  supportsMax: number;
  topics: { id: number; label: string; count: number }[];
}

/** UMAP neighbors and t-SNE perplexity (t-SNE needs k = 3·perplexity ≤ META.k). */
const UMAP_N_NEIGHBORS = 15
const TSNE_PERPLEXITY = 20
const TSNE_K = 3 * TSNE_PERPLEXITY
const EXAGGERATION_TICKS = 250

const SPACE_SIZE = 8192

/**
 * Per-kernel, per-dimensionality simulation settings. t-SNE spreads far wider in
 * embedding units than UMAP (no min_dist plateau), so its unit scale is much
 * smaller. The 3D variants use a smaller scale still: the same points spread
 * over a third axis, so the layout reaches further in embedding units.
 */
const kernelSettings = (kernel: 'umap' | 'tsne', dims: 2 | 3): {
  simulationUmapScale: number;
  simulationRepulsion: number;
  simulationLinkSpring: number;
} => {
  if (kernel === 'tsne') {
    return { simulationUmapScale: dims === 3 ? 14 : 20, simulationRepulsion: 0.5, simulationLinkSpring: 12 }
  }
  return { simulationUmapScale: dims === 3 ? 250 : 350, simulationRepulsion: 2, simulationLinkSpring: 0.5 }
}

/** Extra config applied only in the 3D view (sphere shading, depth cue, camera). */
const VIEW_3D_CONFIG = {
  pointSphereShading: true,
  pointDepthFade: 0.1,
  cameraFov: 55,
} as const

const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`)
  return res.arrayBuffer()
}

/**
 * Aspect-preserving scale of a raw `dims`-dimensional layout into the center of
 * the space (one shared scale across axes, so the shape is never distorted).
 */
const scaleToSpace = (raw: Float32Array, n: number, dims: 2 | 3, spaceSize: number, fill = 0.85): Float32Array => {
  const min = new Float64Array(dims).fill(Infinity)
  const max = new Float64Array(dims).fill(-Infinity)
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dims; d++) {
      const v = raw[i * dims + d] as number
      if (v < (min[d] as number)) min[d] = v
      if (v > (max[d] as number)) max[d] = v
    }
  }
  let extent = 0
  for (let d = 0; d < dims; d++) extent = Math.max(extent, (max[d] as number) - (min[d] as number))
  const scale = (fill * spaceSize) / (extent || 1)
  const center = spaceSize / 2
  const out = new Float32Array(n * dims)
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dims; d++) {
      const mid = ((min[d] as number) + (max[d] as number)) / 2
      out[i * dims + d] = center + ((raw[i * dims + d] as number) - mid) * scale
    }
  }
  return out
}

/** HSL → RGB (all in 0..1). */
const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const f = (nn: number): number => {
    const kk = (nn + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return l - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1))
  }
  return [f(0), f(8), f(4)]
}

/**
 * A distinct hue per labelled topic (id ≥ 0 spread around the wheel); the
 * generic topic -1 is dim grey so the real clusters stand out.
 */
const buildTopicPalette = (topics: Meta['topics']): Map<number, [number, number, number]> => {
  const palette = new Map<number, [number, number, number]>()
  // topic -1 (generic "neighborhood / project" bucket) reads as dim grey.
  palette.set(-1, [0.34, 0.36, 0.42])
  let seen = 0
  for (const t of topics) {
    if (t.id < 0) continue
    // Golden-ratio hue hop maximally separates consecutive topic ids; alternate
    // lightness so even a hue collision stays distinguishable.
    const hue = (seen * 0.618033988749895) % 1
    palette.set(t.id, hslToRgb(hue, 0.62, seen % 2 === 0 ? 0.62 : 0.5))
    seen += 1
  }
  return palette
}

const topicColors = (topic: Int16Array, n: number, palette: Map<number, [number, number, number]>): Float32Array => {
  const colors = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const c = palette.get(topic[i] as number) ?? [0.34, 0.36, 0.42]
    colors[i * 4] = c[0]; colors[i * 4 + 1] = c[1]; colors[i * 4 + 2] = c[2]; colors[i * 4 + 3] = 1
  }
  return colors
}

const supportSizes = (supports: Float32Array, n: number, supportsMax: number, minSize = 2, maxSize = 14): Float32Array => {
  const maxLog = Math.log10(supportsMax + 1) || 1
  const sizes = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = Math.log10((supports[i] as number) + 1) / maxLog
    sizes[i] = minSize + (maxSize - minSize) * t
  }
  return sizes
}

export const decidimEmbedding = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.cssText = 'height: 100vh; width: 100%; position: relative;'
  const graphDiv = document.createElement('div')
  graphDiv.style.cssText = 'position: absolute; inset: 0;'
  div.appendChild(graphDiv)

  const overlay = document.createElement('div')
  overlay.style.cssText = [
    'position: absolute', 'inset: 0', 'display: flex', 'align-items: center', 'justify-content: center',
    'color: #cdd3e0', 'font: 600 15px Helvetica, Arial, sans-serif', 'pointer-events: none', 'z-index: 10',
  ].join(';')
  overlay.textContent = 'Loading proposals…'
  div.appendChild(overlay)

  const meta = JSON.parse(metaRaw) as Meta
  const n = meta.n
  const palette = buildTopicPalette(meta.topics)

  const config: GraphConfig = {
    spaceSize: SPACE_SIZE,
    backgroundColor: '#0b0e1a',
    pointDefaultSize: 4,
    scalePointsOnZoom: true,
    renderLinks: false,
    enableDrag: false,
    enableSimulation: true,
    spaceDimensions: 2,
    // Switches apply instantly. The default animated transition would (a) pause
    // the simulation for its duration and (b) animate z from 0 on a 2D → 3D data
    // switch — and a perfectly flat z = 0 plane is a symmetric equilibrium for
    // the 3D repulsion, so the restarted layout would stay trapped in the plane.
    transitionDuration: 0,
    simulationKernel: 'umap',
    simulationUmapMinDist: 0.1,
    simulationUmapSpread: 1,
    ...kernelSettings('umap', 2),
    simulationGravity: 0.05,
    simulationCenter: 0.1,
    simulationDecay: 30000,
    showFPSMonitor: true,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  // t-SNE early-exaggeration countdown in ticks (frame rate varies across
  // hardware, so the schedule tracks optimization progress, not wall-clock).
  let exaggerationTicksLeft = -1
  config.onSimulationTick = (): void => {
    if (exaggerationTicksLeft > 0) {
      exaggerationTicksLeft -= 1
      if (exaggerationTicksLeft === 0) graph.setConfigPartial({ simulationLinkSpring: 1 })
    }
  }

  const graph = new Graph(graphDiv, config)

  // ── Controls: mode toggle + pause ───────────────────────────────────────────
  const panel = document.createElement('div')
  panel.style.cssText = [
    'position: absolute', 'top: 12px', 'left: 12px', 'z-index: 1000', 'display: none',
    'gap: 6px', 'align-items: center',
    'font: 600 12px Helvetica, Arial, sans-serif',
  ].join(';')
  const modeButtons: Record<Mode, HTMLButtonElement> = {
    umap: document.createElement('button'),
    tsne: document.createElement('button'),
    precomputed: document.createElement('button'),
  }
  modeButtons.umap.textContent = 'UMAP'
  modeButtons.tsne.textContent = 't-SNE'
  modeButtons.precomputed.textContent = 'Precomputed'
  for (const button of Object.values(modeButtons)) {
    button.style.cssText = [
      'padding: 6px 14px', 'font: 600 12px Helvetica, Arial, sans-serif', 'color: #fff',
      'border: none', 'border-radius: 14px', 'cursor: pointer',
    ].join(';')
    panel.appendChild(button)
  }
  // 2D / 3D view switch — flips `spaceDimensions` live and restarts the active
  // kernel from the matching PCA init.
  const button2d = document.createElement('button')
  const button3d = document.createElement('button')
  button2d.textContent = '2D'
  button3d.textContent = '3D'
  const dimsButtons = [button2d, button3d]
  const dimsGroup = document.createElement('span')
  dimsGroup.style.cssText = 'margin-left: 14px; display: flex; gap: 6px;'
  for (const button of dimsButtons) {
    button.style.cssText = [
      'padding: 6px 14px', 'font: 600 12px Helvetica, Arial, sans-serif', 'color: #fff',
      'border: none', 'border-radius: 14px', 'cursor: pointer',
    ].join(';')
    dimsGroup.appendChild(button)
  }
  panel.appendChild(dimsGroup)

  const pauseButton = document.createElement('button')
  pauseButton.textContent = 'Pause'
  pauseButton.style.cssText = [
    'margin-left: 14px', 'padding: 6px 14px', 'color: #fff', 'background: #2f3550',
    'border: none', 'border-radius: 14px', 'cursor: pointer',
  ].join(';')
  panel.appendChild(pauseButton)
  const status = document.createElement('span')
  status.style.cssText = 'margin-left: 10px; color: #8b93a7; font-weight: 500;'
  panel.appendChild(status)
  div.appendChild(panel)

  const highlightControls = (activeMode: Mode, activeDims: 2 | 3): void => {
    for (const [mode, button] of Object.entries(modeButtons)) {
      button.style.background = mode === activeMode ? '#5f69de' : '#2f3550'
    }
    button2d.style.background = activeDims === 2 ? '#5f69de' : '#2f3550'
    button3d.style.background = activeDims === 3 ? '#5f69de' : '#2f3550'
  }

  // ── Topic legend (top labelled topics by count) ──────────────────────────────
  const legend = document.createElement('div')
  legend.style.cssText = [
    'position: absolute', 'bottom: 12px', 'left: 12px', 'z-index: 1000', 'padding: 8px 10px',
    'display: none', 'grid-template-columns: auto auto', 'gap: 2px 12px', 'max-width: 460px',
    'font: 500 11px Helvetica, Arial, sans-serif', 'color: #cdd3e0',
    'background: rgba(11,14,26,0.6)', 'border-radius: 8px',
  ].join(';')
  const legendTopics = meta.topics.filter((t) => t.id >= 0).sort((a, b) => b.count - a.count).slice(0, 12)
  for (const t of legendTopics) {
    const c = palette.get(t.id) as [number, number, number]
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; align-items: center; gap: 5px; overflow: hidden; white-space: nowrap;'
    const rgb = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`
    row.innerHTML = `<span style="flex:none;width:9px;height:9px;border-radius:2px;background:${rgb}"></span>${t.label}`
    legend.appendChild(row)
  }
  div.appendChild(legend)

  // ── Data + mode wiring ────────────────────────────────────────────────────────
  let cancelled = false
  const graphCache = new Map<Mode, UmapGraph>()

  const run = async (): Promise<void> => {
    const [idxBuf, distBuf, initBuf, init3dBuf, precomputedBuf, topicBuf, supportsBuf] = await Promise.all([
      fetchBytes(knnIdxUrl), fetchBytes(knnDistUrl), fetchBytes(initUrl), fetchBytes(init3dUrl),
      fetchBytes(precomputedUrl), fetchBytes(topicUrl), fetchBytes(supportsUrl),
    ])
    if (cancelled) return

    const idxU16 = new Uint16Array(idxBuf)
    const knn = {
      indices: Int32Array.from(idxU16),
      distances: new Float32Array(distBuf),
    }
    // PCA init per view dimensionality — the 2D one is the 3D one's first two axes.
    const init2dPositions = scaleToSpace(new Float32Array(initBuf), n, 2, SPACE_SIZE)
    const init3dPositions = scaleToSpace(new Float32Array(init3dBuf), n, 3, SPACE_SIZE)
    const initFor = (dims: 2 | 3): Float32Array => (dims === 3 ? init3dPositions : init2dPositions)
    const precomputedPositions = scaleToSpace(new Float32Array(precomputedBuf), n, 2, SPACE_SIZE)
    const topic = new Int16Array(topicBuf)
    const supports = new Float32Array(supportsBuf)

    graph.setPointColors(topicColors(topic, n, palette))
    graph.setPointSizes(supportSizes(supports, n, meta.supportsMax))

    const buildGraphFor = (kernel: 'umap' | 'tsne'): UmapGraph => {
      let result = graphCache.get(kernel)
      if (!result) {
        result = kernel === 'tsne'
          ? buildTsneGraph(sliceKnnLists(knn, n, meta.k, TSNE_K), n, TSNE_K, TSNE_PERPLEXITY)
          : buildUmapGraph(sliceKnnLists(knn, n, meta.k, UMAP_N_NEIGHBORS), n, UMAP_N_NEIGHBORS)
        graphCache.set(kernel, result)
      }
      return result
    }

    let activeMode: Mode = 'umap'
    let activeDims: 2 | 3 = 2
    let busy = false

    // Fit a frame later: a synchronous fitView races the position upload (and,
    // on a kernel or dimensionality switch, the shader recompile), computing its
    // target from stale positions and framing an empty view.
    const fitLater = (): void => { setTimeout(() => { if (!cancelled) graph.fitView(400) }, 80) }

    /** The precomputed layout has no z, so in 3D it can only be a flat plane. */
    const noteFor = (mode: Mode, dims: 2 | 3): string =>
      (mode === 'precomputed' && dims === 3 ? 'dataset ships x/y only — flat plane at z = 0' : '')

    const apply = (mode: Mode, dims: 2 | 3, buildStatus: string): void => {
      if (busy || cancelled) return
      if (mode === activeMode && dims === activeDims) return
      busy = true
      status.textContent = buildStatus || 'switching…'
      const allButtons = [...Object.values(modeButtons), ...dimsButtons]
      for (const button of allButtons) button.disabled = true
      // Yield so the status paints before a (brief) synchronous graph build.
      setTimeout(() => {
        try {
          if (cancelled) return
          const dimsChanged = dims !== activeDims
          activeMode = mode
          activeDims = dims
          // Flipping spaceDimensions swaps the gestures (pan/zoom ⇄ orbit) and
          // rebuilds the mode-specific GPU resources; the 3D-only shading and
          // camera settings ride along.
          if (dimsChanged) {
            graph.setConfigPartial(dims === 3
              ? { spaceDimensions: 3, ...VIEW_3D_CONFIG }
              : { spaceDimensions: 2, pointSphereShading: false, pointDepthFade: 0 })
          }
          if (mode === 'precomputed') {
            graph.pause()
            exaggerationTicksLeft = -1
            // 2D data: in the 3D view these lie in the z = 0 plane.
            graph.setPointPositions(precomputedPositions, { dimensions: 2 })
            graph.render()
            fitLater()
          } else {
            const built = buildGraphFor(mode)
            graph.setConfigPartial({ simulationKernel: mode, ...kernelSettings(mode, dims) })
            graph.setLinks(built.links)
            graph.setLinkStrength(built.strengths)
            // Reproducible: restart from the PCA init matching this view.
            graph.setPointPositions(initFor(dims), { dimensions: dims })
            exaggerationTicksLeft = mode === 'tsne' ? EXAGGERATION_TICKS : -1
            graph.render()
            graph.start(1)
            fitLater()
            pauseButton.textContent = 'Pause'
          }
          highlightControls(mode, dims)
        } finally {
          busy = false
          for (const button of allButtons) button.disabled = false
          status.textContent = noteFor(activeMode, activeDims)
        }
      }, 20)
    }

    modeButtons.umap.addEventListener('click', () => apply('umap', activeDims, 'building UMAP graph…'))
    modeButtons.tsne.addEventListener('click', () => apply('tsne', activeDims, 'calibrating t-SNE perplexity…'))
    modeButtons.precomputed.addEventListener('click', () => apply('precomputed', activeDims, ''))
    button2d.addEventListener('click', () => apply(activeMode, 2, 'switching to 2D…'))
    button3d.addEventListener('click', () => apply(activeMode, 3, 'switching to 3D…'))
    pauseButton.addEventListener('click', () => {
      if (activeMode === 'precomputed') return
      if (graph.isSimulationRunning) { graph.pause(); pauseButton.textContent = 'Start' } else { graph.unpause(); pauseButton.textContent = 'Pause' }
    })

    // Initial mode: UMAP from the PCA init.
    const umapGraph = buildGraphFor('umap')
    graph.setLinks(umapGraph.links)
    graph.setLinkStrength(umapGraph.strengths)
    graph.setPointPositions(initFor(activeDims), { dimensions: activeDims })
    graph.render()
    graph.start(1)
    // Defer the first fit so the initial positions reach the GPU before the fit
    // computes its target extent (a synchronous fitView here races the upload).
    setTimeout(() => { if (!cancelled) graph.fitView(400) }, 50)
    highlightControls(activeMode, activeDims)

    overlay.remove()
    panel.style.display = 'flex'
    legend.style.display = 'grid'
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
