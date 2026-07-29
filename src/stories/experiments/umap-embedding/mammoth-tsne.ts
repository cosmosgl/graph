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
 * schedule: early exaggeration for `simulationTsneExaggerationIterations` ticks,
 * then a clean optimizer state.
 *
 * Every t-SNE parameter is live-editable from the panel, so the optimizer can be
 * explored without reloading: the kernel parameters are shader uniforms and the
 * schedule is read per tick. The optimizer switch picks between the default
 * `friction` integration and reference t-SNE's `momentum` + per-point gains
 * (where the learning rate η applies).
 */
export const mammothTsneProjection = async (): Promise<{ graph: Graph; div: HTMLDivElement; destroy?: () => void }> => {
  // Yield once so the "Loading story…" placeholder paints before the synchronous
  // kNN build below blocks the main thread.
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })

  const div = document.createElement('div')
  div.style.cssText = 'height: 100vh; width: 100%; position: relative;'
  const graphDiv = document.createElement('div')
  graphDiv.style.cssText = 'position: absolute; inset: 0;'
  div.appendChild(graphDiv)

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
    simulationTsneExaggeration: 12,
    simulationTsneExaggerationIterations: 250,
    simulationTsneOptimizer: 'friction',
    simulationTsneLearningRate: 0.15,
    // Light gravity + centering keep the layout compact and framed under the
    // default `friction` integrator (positions are hard-clamped to the space).
    simulationGravity: 0.05,
    simulationCenter: 0.1,
    simulationDecay: 5000,
    showFPSMonitor: true,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  // Mirrors the engine's own t-SNE iteration counter (both start at `start()`),
  // so the panel can show which phase of the schedule the layout is in.
  let iteration = 0
  // Assigned once the panel exists; the tick callback below may fire before that.
  let updateReadout: () => void = () => {}
  config.onSimulationTick = (): void => {
    iteration += 1
    updateReadout()
  }

  const graph = new Graph(graphDiv, config)

  // PCA-style init (project onto the two highest-variance 3D axes) so the
  // simulation refines a coherent silhouette instead of untangling a hairball.
  const positions = coordInit2D(data.vectors, n, spaceSize)

  // ── Controls ────────────────────────────────────────────────────────────────
  const panel = document.createElement('div')
  panel.style.cssText = [
    'position: absolute', 'top: 12px', 'left: 12px', 'z-index: 1000', 'padding: 12px 14px',
    'display: flex', 'flex-direction: column', 'gap: 8px', 'width: 300px',
    'font: 500 12px/1.4 Menlo, monospace', 'color: #cdd3e0',
    'background: rgba(11,14,26,0.82)', 'border-radius: 10px',
  ].join(';')
  div.appendChild(panel)

  const buttonCss = [
    'padding: 6px 12px', 'font: 600 11px Helvetica, Arial, sans-serif', 'color: #fff',
    'background: #2f3550', 'border: none', 'border-radius: 12px', 'cursor: pointer',
  ].join(';')

  const buttonRow = document.createElement('div')
  buttonRow.style.cssText = 'display: flex; gap: 6px;'
  const pauseButton = document.createElement('button')
  pauseButton.textContent = 'Pause'
  const restartButton = document.createElement('button')
  restartButton.textContent = 'Restart'
  const fitButton = document.createElement('button')
  fitButton.textContent = 'Fit'
  for (const button of [pauseButton, restartButton, fitButton]) {
    button.style.cssText = buttonCss
    buttonRow.appendChild(button)
  }
  panel.appendChild(buttonRow)

  const readout = document.createElement('div')
  readout.style.cssText = 'opacity: 0.8; white-space: pre;'
  panel.appendChild(readout)

  /**
   * Adds a labelled slider that writes its value straight into the config; every
   * t-SNE parameter is read live (uniforms, or per-tick schedule values).
   */
  const addSlider = (
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    apply: (v: number) => void,
    format: (v: number) => string = (v: number): string => String(v)
  ): { input: HTMLInputElement; setEnabled: (enabled: boolean) => void } => {
    const row = document.createElement('div')
    const head = document.createElement('div')
    head.style.cssText = 'display: flex; justify-content: space-between; gap: 8px;'
    const name = document.createElement('span')
    name.textContent = label
    const valueLabel = document.createElement('span')
    valueLabel.textContent = format(value)
    valueLabel.style.cssText = 'color: #7f9cf5; font-weight: 700;'
    head.append(name, valueLabel)
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.style.cssText = 'width: 100%; margin-top: 2px;'
    input.addEventListener('input', () => {
      const v = Number(input.value)
      valueLabel.textContent = format(v)
      apply(v)
    })
    row.append(head, input)
    panel.appendChild(row)
    return {
      input,
      setEnabled: (enabled: boolean): void => {
        input.disabled = !enabled
        row.style.opacity = enabled ? '1' : '0.4'
      },
    }
  }

  const optimizerRow = document.createElement('div')
  optimizerRow.style.cssText = 'display: flex; align-items: center; gap: 6px;'
  const optimizerLabel = document.createElement('span')
  optimizerLabel.textContent = 'optimizer'
  optimizerRow.appendChild(optimizerLabel)
  const frictionButton = document.createElement('button')
  frictionButton.textContent = 'friction'
  const momentumButton = document.createElement('button')
  momentumButton.textContent = 'momentum'
  for (const button of [frictionButton, momentumButton]) {
    button.style.cssText = buttonCss
    optimizerRow.appendChild(button)
  }
  panel.appendChild(optimizerRow)

  const learningRate = addSlider('learning rate (η)', 0.02, 1, 0.02, 0.15,
    (v) => graph.setConfigPartial({ simulationTsneLearningRate: v }), (v) => v.toFixed(2))
  addSlider('early exaggeration', 1, 20, 0.5, 12,
    (v) => graph.setConfigPartial({ simulationTsneExaggeration: v }), (v) => v.toFixed(1))
  addSlider('exaggeration length (iter.)', 0, 800, 10, 250,
    (v) => graph.setConfigPartial({ simulationTsneExaggerationIterations: v }))
  addSlider('attraction · compactness', 0.1, 5, 0.1, 1,
    (v) => graph.setConfigPartial({ simulationLinkSpring: v }), (v) => v.toFixed(1))
  addSlider('repulsion · spread', 0.1, 5, 0.1, 1,
    (v) => graph.setConfigPartial({ simulationRepulsion: v }), (v) => v.toFixed(1))
  addSlider('embedding unit scale', 5, 150, 1, umapScale,
    (v) => graph.setConfigPartial({ simulationUmapScale: v }))

  let optimizer: 'friction' | 'momentum' = 'friction'
  const applyOptimizer = (next: 'friction' | 'momentum'): void => {
    optimizer = next
    frictionButton.style.background = next === 'friction' ? '#5f69de' : '#2f3550'
    momentumButton.style.background = next === 'momentum' ? '#5f69de' : '#2f3550'
    // η only feeds the momentum integrator; under `friction` the step comes from
    // simulationFriction and alpha decay instead.
    learningRate.setEnabled(next === 'momentum')
    graph.setConfigPartial({ simulationTsneOptimizer: next })
    updateReadout()
  }

  updateReadout = (): void => {
    const exaggerationIterations = Number(graph.config.simulationTsneExaggerationIterations ?? 0)
    const phase = iteration < exaggerationIterations
      ? `exagg ×${Number(graph.config.simulationTsneExaggeration ?? 1).toFixed(1)}`
      : 'settle'
    readout.textContent = `iteration ${iteration}   phase ${phase}\npoints ${n.toLocaleString('en-US')}   optimizer ${optimizer}`
  }

  const restart = (): void => {
    iteration = 0
    // start() resets the engine's schedule counter and the integrator state, so
    // the run is reproducible from the same PCA init.
    graph.setPointPositions(positions)
    graph.render()
    graph.start(1)
    pauseButton.textContent = 'Pause'
    updateReadout()
  }

  pauseButton.addEventListener('click', () => {
    if (graph.isSimulationRunning) {
      graph.pause()
      pauseButton.textContent = 'Start'
    } else {
      graph.unpause()
      pauseButton.textContent = 'Pause'
    }
  })
  restartButton.addEventListener('click', restart)
  fitButton.addEventListener('click', () => { graph.fitView(400, 0.15, false) })
  frictionButton.addEventListener('click', () => applyOptimizer('friction'))
  momentumButton.addEventListener('click', () => applyOptimizer('momentum'))

  graph.setPointPositions(positions)
  graph.setPointColors(labelColors(labels))
  graph.setLinks(links)
  graph.setLinkStrength(strengths)
  graph.render()
  applyOptimizer('friction')

  // The layout expands as t-SNE spreads the clusters; re-fit periodically with
  // `enableSimulation: false` (reframes WITHOUT reheating), then stop so the
  // view is free to pan/zoom — use Fit to reframe by hand afterwards.
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
