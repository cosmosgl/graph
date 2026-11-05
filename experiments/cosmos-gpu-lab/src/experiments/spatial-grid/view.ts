import type { ExperimentInstance } from '../../runtime/experiment'
import {
  createSpatialGridBackend,
  formatGridBytes,
  type SpatialGridBackend,
} from './backend'
import {
  createCpuGridReference,
  createGridPositions,
  type CpuGridReference,
  type GridValidation,
  type PointDistribution,
  validateGrid,
} from './reference'

const POINT_PRESETS = [100_000, 1_000_000, 5_000_000] as const
const GRID_PRESETS = [32, 64, 128, 256] as const
const DEFAULT_POINT_COUNT = 1_000_000
const DEFAULT_GRID_SIZE = 128

function element<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const found = host.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

function nextFrame (): Promise<void> {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()))
}

function benchmarkIterations (pointCount: number): number {
  if (pointCount >= 5_000_000) return 1
  if (pointCount >= 1_000_000) return 3
  return 10
}

function percentile (values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

function validationLabel (validation: GridValidation): string {
  if (validation.valid) return 'Exact · every point appears once'
  return [
    `${validation.countMismatches} count`,
    `${validation.offsetMismatches} offset`,
    `${validation.invalidMemberships} membership`,
    `${validation.duplicateIndices} duplicate`,
    `${validation.missingIndices} missing`,
  ].join(' · ')
}

function renderHeatmap (
  canvas: HTMLCanvasElement,
  reference: CpuGridReference,
  gridSize: number,
  pointCount: number,
  distribution: PointDistribution
): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const width = canvas.width
  const height = canvas.height
  context.fillStyle = '#20242b'
  context.fillRect(0, 0, width, height)

  const plotSize = Math.min(height - 54, width - 280)
  const left = 26
  const top = 27
  const cellSize = plotSize / gridSize
  const scale = Math.log1p(reference.maximumCellLoad)
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const count = reference.counts[y * gridSize + x]
      const intensity = scale === 0 ? 0 : Math.log1p(count) / scale
      const red = Math.round(42 + intensity * 112)
      const green = Math.round(54 + intensity * 151)
      const blue = Math.round(68 + intensity * 120)
      context.fillStyle = `rgb(${red}, ${green}, ${blue})`
      context.fillRect(
        left + x * cellSize,
        top + (gridSize - y - 1) * cellSize,
        Math.ceil(cellSize),
        Math.ceil(cellSize)
      )
    }
  }
  context.strokeStyle = '#68717d'
  context.strokeRect(left - 0.5, top - 0.5, plotSize + 1, plotSize + 1)

  const textLeft = left + plotSize + 28
  context.fillStyle = '#e4e6e8'
  context.font = '500 15px system-ui, sans-serif'
  context.fillText('Cell occupancy', textLeft, top + 12)
  context.fillStyle = '#9fa5ae'
  context.font = '12px ui-monospace, monospace'
  const lines = [
    `${pointCount.toLocaleString()} points`,
    `${gridSize} × ${gridSize} cells`,
    `${reference.occupiedCells.toLocaleString()} occupied`,
    `${reference.maximumCellLoad.toLocaleString()} max load`,
    distribution,
  ]
  lines.forEach((line, index) => context.fillText(line, textLeft, top + 42 + index * 22))

  const legendTop = top + 180
  const gradient = context.createLinearGradient(textLeft, 0, textLeft + 170, 0)
  gradient.addColorStop(0, 'rgb(42, 54, 68)')
  gradient.addColorStop(1, 'rgb(154, 205, 188)')
  context.fillStyle = gradient
  context.fillRect(textLeft, legendTop, 170, 8)
  context.fillStyle = '#858c96'
  context.font = '10px ui-monospace, monospace'
  context.fillText('0', textLeft, legendTop + 23)
  context.fillText('log(max)', textLeft + 122, legendTop + 23)
}

export async function createSpatialGridExperiment (
  host: HTMLElement
): Promise<ExperimentInstance> {
  host.innerHTML = `
    <section class="spatial-grid-demo">
      <div class="scale-toolbar grid-toolbar">
        <label>
          <span>Points</span>
          <select data-control="point-count">
            ${POINT_PRESETS.map(count => `
              <option value="${count}" ${count === DEFAULT_POINT_COUNT ? 'selected' : ''}>
                ${count.toLocaleString()}
              </option>
            `).join('')}
          </select>
        </label>
        <label>
          <span>Grid</span>
          <select data-control="grid-size">
            ${GRID_PRESETS.map(size => `
              <option value="${size}" ${size === DEFAULT_GRID_SIZE ? 'selected' : ''}>
                ${size} × ${size}
              </option>
            `).join('')}
          </select>
        </label>
        <label>
          <span>Distribution</span>
          <select data-control="distribution">
            <option value="uniform">Uniform</option>
            <option value="clusters">Eight clusters</option>
            <option value="diagonal">Diagonal stress case</option>
          </select>
        </label>
        <div class="controls">
          <button data-action="build" type="button" disabled>Build + validate</button>
          <button data-action="benchmark" type="button" disabled>Benchmark</button>
        </div>
      </div>

      <section class="scale-status" aria-live="polite">
        <span data-output="status">Creating WebGPU resources…</span>
        <span data-output="phase">Preparing</span>
      </section>

      <div class="grid-pipeline" aria-label="Spatial grid build stages">
        <span>positions</span><b>→</b><span>count</span><b>→</b><span>scan</span><b>→</b>
        <span>scatter</span><b>→</b><span>CSR grid</span>
      </div>

      <canvas class="scale-canvas grid-canvas" data-output="canvas" width="900" height="440"></canvas>

      <section class="scale-metrics grid-metrics">
        <div><span>Scan hierarchy</span><strong data-output="hierarchy">—</strong></div>
        <div><span>Position storage</span><strong data-output="positions">—</strong></div>
        <div><span>Grid storage</span><strong data-output="grid-memory">—</strong></div>
        <div><span>Occupied cells</span><strong data-output="occupied">—</strong></div>
        <div><span>Maximum cell load</span><strong data-output="maximum">—</strong></div>
        <div><span>Correctness</span><strong data-output="validation">—</strong></div>
        <div><span>Build + completion</span><strong data-output="timing">—</strong></div>
        <div><span>Steady-state benchmark</span><strong data-output="benchmark">Not run</strong></div>
      </section>

      <p class="demo-note">
        Timed builds keep positions, counts, offsets, cursors and grouped point indices on the GPU.
        Readback and exhaustive CPU validation happen once after the build and are excluded from the timing.
      </p>
    </section>
  `

  const pointCountSelect = element<HTMLSelectElement>(host, '[data-control="point-count"]')
  const gridSizeSelect = element<HTMLSelectElement>(host, '[data-control="grid-size"]')
  const distributionSelect = element<HTMLSelectElement>(host, '[data-control="distribution"]')
  const buildButton = element<HTMLButtonElement>(host, '[data-action="build"]')
  const benchmarkButton = element<HTMLButtonElement>(host, '[data-action="benchmark"]')
  const statusOutput = element<HTMLElement>(host, '[data-output="status"]')
  const phaseOutput = element<HTMLElement>(host, '[data-output="phase"]')
  const timingOutput = element<HTMLElement>(host, '[data-output="timing"]')
  const benchmarkOutput = element<HTMLElement>(host, '[data-output="benchmark"]')
  const validationOutput = element<HTMLElement>(host, '[data-output="validation"]')
  const canvas = element<HTMLCanvasElement>(host, '[data-output="canvas"]')

  let backend: SpatialGridBackend | undefined
  let positions: Float32Array | undefined
  let reference: CpuGridReference | undefined
  let destroyed = false
  let busy = false
  let revision = 0

  const setControlsDisabled = (disabled: boolean): void => {
    pointCountSelect.disabled = disabled
    gridSizeSelect.disabled = disabled
    distributionSelect.disabled = disabled
    buildButton.disabled = disabled
    benchmarkButton.disabled = disabled
  }

  const buildAndValidate = async (): Promise<void> => {
    if (!backend || !positions || !reference || busy || destroyed) return
    busy = true
    setControlsDisabled(true)
    try {
      statusOutput.textContent = 'Encoding count, hierarchical scan and scatter passes…'
      phaseOutput.textContent = 'GPU build'
      await nextFrame()
      const elapsed = await backend.build()
      timingOutput.textContent = `${elapsed.toFixed(2)} ms`

      statusOutput.textContent = 'Reading the finished CSR grid for exhaustive validation…'
      phaseOutput.textContent = 'CPU validation'
      await nextFrame()
      const grid = await backend.readback()
      const validation = validateGrid(
        positions,
        backend.gridSize,
        reference,
        grid.counts,
        grid.offsets,
        grid.pointIndices
      )
      validationOutput.textContent = validationLabel(validation)
      validationOutput.classList.toggle('metric-error', !validation.valid)
      renderHeatmap(
        canvas,
        reference,
        backend.gridSize,
        backend.pointCount,
        distributionSelect.value as PointDistribution
      )
      statusOutput.textContent = validation.valid
        ? 'GPU grid matches the CPU reference exactly.'
        : 'Validation found a mismatch; inspect the correctness metric.'
      phaseOutput.textContent = validation.valid ? 'Ready' : 'Mismatch'
    } finally {
      busy = false
      if (!destroyed) setControlsDisabled(false)
    }
  }

  const configure = async (): Promise<void> => {
    revision += 1
    const configurationRevision = revision
    backend?.destroy()
    backend = undefined
    positions = undefined
    reference = undefined
    setControlsDisabled(true)
    busy = true
    benchmarkOutput.textContent = 'Not run'
    validationOutput.textContent = '—'
    timingOutput.textContent = '—'
    const pointCount = Number(pointCountSelect.value)
    const gridSize = Number(gridSizeSelect.value)
    const distribution = distributionSelect.value as PointDistribution
    statusOutput.textContent = `Generating ${pointCount.toLocaleString()} deterministic positions…`
    phaseOutput.textContent = 'CPU setup'
    await nextFrame()

    try {
      const nextPositions = createGridPositions(pointCount, distribution)
      const nextReference = createCpuGridReference(nextPositions, gridSize)
      statusOutput.textContent = 'Allocating GPU grid buffers and pipelines…'
      phaseOutput.textContent = 'GPU setup'
      await nextFrame()
      const nextBackend = await createSpatialGridBackend(nextPositions, gridSize)
      if (destroyed || configurationRevision !== revision) {
        nextBackend.destroy()
        return
      }
      positions = nextPositions
      reference = nextReference
      backend = nextBackend
      element<HTMLElement>(host, '[data-output="hierarchy"]').textContent =
        nextBackend.scanHierarchy.map(count => count.toLocaleString()).join(' → ')
      element<HTMLElement>(host, '[data-output="positions"]').textContent =
        formatGridBytes(nextBackend.positionBytes)
      element<HTMLElement>(host, '[data-output="grid-memory"]').textContent =
        formatGridBytes(nextBackend.gridBytes)
      element<HTMLElement>(host, '[data-output="occupied"]').textContent =
        `${nextReference.occupiedCells.toLocaleString()} / ${nextBackend.cellCount.toLocaleString()}`
      element<HTMLElement>(host, '[data-output="maximum"]').textContent =
        `${nextReference.maximumCellLoad.toLocaleString()} points`
      busy = false
      await buildAndValidate()
    } catch (error) {
      statusOutput.textContent = error instanceof Error ? error.message : String(error)
      phaseOutput.textContent = 'Unavailable'
      busy = false
      if (!destroyed) {
        pointCountSelect.disabled = false
        gridSizeSelect.disabled = false
        distributionSelect.disabled = false
      }
    }
  }

  buildButton.addEventListener('click', () => {
    buildAndValidate().catch(error => {
      statusOutput.textContent = error instanceof Error ? error.message : String(error)
      phaseOutput.textContent = 'Failed'
    })
  })
  benchmarkButton.addEventListener('click', () => {
    if (!backend || busy || destroyed) return
    busy = true
    setControlsDisabled(true)
    const activeBackend = backend
    const iterations = benchmarkIterations(activeBackend.pointCount)
    const samples: number[] = []
    statusOutput.textContent = `Benchmarking ${iterations} builds per sample…`
    phaseOutput.textContent = 'Warm-up'
    activeBackend.benchmark(iterations)
      .then(async () => {
        for (let sample = 0; sample < 6; sample += 1) {
          phaseOutput.textContent = `Sample ${sample + 1} / 6`
          const result = await activeBackend.benchmark(iterations)
          samples.push(result.averageMilliseconds)
        }
        const p50 = percentile(samples, 0.5)
        const p95 = percentile(samples, 0.95)
        benchmarkOutput.textContent = `p50 ${p50.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms`
        statusOutput.textContent = 'Steady-state benchmark complete.'
        phaseOutput.textContent = 'Ready'
      })
      .catch(error => {
        statusOutput.textContent = error instanceof Error ? error.message : String(error)
        phaseOutput.textContent = 'Failed'
      })
      .finally(() => {
        busy = false
        if (!destroyed) setControlsDisabled(false)
      })
  })

  pointCountSelect.addEventListener('change', () => { configure().catch(console.error) })
  gridSizeSelect.addEventListener('change', () => { configure().catch(console.error) })
  distributionSelect.addEventListener('change', () => { configure().catch(console.error) })
  configure().catch(console.error)

  return {
    destroy (): void {
      if (destroyed) return
      destroyed = true
      revision += 1
      backend?.destroy()
      host.replaceChildren()
    },
  }
}
