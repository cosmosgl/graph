import type { ExperimentInstance } from '../../runtime/experiment'
import type { PointRenderBackend } from '../point-rendering/backend'
import { createPointData } from '../point-rendering/point-data'
import { createWebGLPointRenderer } from '../point-rendering/webgl/backend'
import { createWebGPUPointRenderer } from '../point-rendering/webgpu/backend'
import { calculateInitialCpuCenter } from '../scalable-reduction/reference'
import { summarizeSamples, type SampleSummary, type SimulationBenchmarkBackend } from './backend'
import { createWebGLSimulationBenchmark } from './webgl-simulation'
import { createWebGPUSimulationBenchmark } from './webgpu-simulation'

type Workload = 'rendering' | 'simulation'
type BenchmarkPreset = 'quick' | 'stable'

type BackendReport = {
  backend: 'WebGL 2' | 'WebGPU';
  status: 'complete' | 'unavailable';
  setupMilliseconds?: number;
  submitSamples: number[];
  completionSamples: number[];
  submit?: SampleSummary;
  completion?: SampleSummary;
  throughputMillionsPerSecond?: number;
  correctness?: string;
  error?: string;
}

type PerformanceReport = {
  schemaVersion: 1;
  recordedAt: string;
  workload: Workload;
  timing: 'synchronized-completion-wall-time';
  parameters: {
    pointCount: number;
    diameter?: number;
    warmupIterations: number;
    samples: number;
    iterationsPerSample: number;
  };
  environment: {
    userAgent: string;
    hardwareConcurrency: number;
    devicePixelRatio: number;
    canvas: string;
  };
  results: BackendReport[];
}

type RenderSlot = {
  name: BackendReport['backend'];
  backend?: PointRenderBackend;
  report: BackendReport;
}

type SimulationSlot = {
  name: BackendReport['backend'];
  backend?: SimulationBenchmarkBackend;
  report: BackendReport;
}

const RENDER_COUNTS = [10_000, 100_000, 1_000_000]
const SIMULATION_COUNTS = [8_192, 65_536, 1_000_000]
const MINIMUM_RELIABLE_BATCH_MILLISECONDS = 1

function element<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const found = host.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

function formatMilliseconds (value: number | undefined): string {
  if (value === undefined) return '—'
  if (value === 0) return '≤ timer resolution'
  if (value < 0.01) return '<0.01 ms'
  return `${value.toFixed(value < 1 ? 3 : 2)} ms`
}

function escapeHtml (value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function centerDistance (
  left: { x: number; y: number },
  right: { x: number; y: number }
): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function benchmarkShape (preset: BenchmarkPreset): { warmups: number; samples: number } {
  return preset === 'stable' ? { warmups: 5, samples: 20 } : { warmups: 2, samples: 6 }
}

function simulationBatchSize (pointCount: number): number {
  if (pointCount >= 1_000_000) return 10
  if (pointCount >= 65_536) return 100
  return 500
}

function renderingBatchSize (pointCount: number): number {
  if (pointCount >= 1_000_000) return 10
  if (pointCount >= 100_000) return 100
  return 200
}

function nextFrame (): Promise<void> {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()))
}

export async function createPerformanceLab (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `
    <section class="performance-lab">
      <div class="scale-toolbar benchmark-toolbar">
        <label>
          Workload
          <select data-control="workload">
            <option value="rendering">Circle rendering</option>
            <option value="simulation">Center-mass reduction</option>
          </select>
        </label>
        <label>
          Points
          <select data-control="count"></select>
        </label>
        <label data-control-group="diameter">
          Diameter
          <select data-control="diameter">
            <option value="2">2 px</option>
            <option value="8" selected>8 px</option>
            <option value="24">24 px</option>
          </select>
        </label>
        <label>
          Run
          <select data-control="preset">
            <option value="quick">Quick · 6 samples</option>
            <option value="stable">Stable · 20 samples</option>
          </select>
        </label>
        <div class="controls">
          <button data-action="run" type="button">Run benchmark</button>
          <button data-action="export" type="button" disabled>Export JSON</button>
        </div>
      </div>

      <section class="benchmark-status" aria-live="polite">
        <div>
          <span data-output="status">Choose a workload and run the benchmark.</span>
          <strong data-output="progress-label">Idle</strong>
        </div>
        <progress data-output="progress" max="1" value="0"></progress>
      </section>

      <section class="benchmark-preview" aria-label="Rendering benchmark preview">
        <article>
          <span>WebGL 2 · point sprite</span>
          <canvas data-canvas="webgl" width="480" height="270"></canvas>
        </article>
        <article>
          <span>WebGPU · instanced quad</span>
          <canvas data-canvas="webgpu" width="480" height="270"></canvas>
        </article>
      </section>

      <section class="benchmark-results">
        <div class="benchmark-empty">
          <p class="eyebrow">No measurements yet</p>
          <p>Pipeline creation, warm-up and data generation are kept outside sampled iterations.</p>
        </div>
      </section>

      <p class="demo-note benchmark-note">
        Completion time deliberately waits for each API to finish: <code>gl.finish()</code> for
        WebGL and <code>queue.onSubmittedWorkDone()</code> for WebGPU. It is a portable synchronized
        wall-time measurement, not a pure timestamp-query GPU duration. Use relative results on the
        same device; do not compare exported reports from unlike hardware as an API verdict.
      </p>
    </section>
  `

  const workloadSelect = element<HTMLSelectElement>(host, '[data-control="workload"]')
  const countSelect = element<HTMLSelectElement>(host, '[data-control="count"]')
  const diameterSelect = element<HTMLSelectElement>(host, '[data-control="diameter"]')
  const diameterGroup = element<HTMLElement>(host, '[data-control-group="diameter"]')
  const presetSelect = element<HTMLSelectElement>(host, '[data-control="preset"]')
  const runButton = element<HTMLButtonElement>(host, '[data-action="run"]')
  const exportButton = element<HTMLButtonElement>(host, '[data-action="export"]')
  const statusOutput = element<HTMLElement>(host, '[data-output="status"]')
  const progressLabel = element<HTMLElement>(host, '[data-output="progress-label"]')
  const progress = element<HTMLProgressElement>(host, '[data-output="progress"]')
  const preview = element<HTMLElement>(host, '.benchmark-preview')
  const resultsHost = element<HTMLElement>(host, '.benchmark-results')
  let webglCanvas = element<HTMLCanvasElement>(host, '[data-canvas="webgl"]')
  let webgpuCanvas = element<HTMLCanvasElement>(host, '[data-canvas="webgpu"]')
  let activeBackends: Array<{ destroy: () => void }> = []
  let lastReport: PerformanceReport | undefined
  let destroyed = false
  let runRevision = 0

  const destroyBackends = (): void => {
    for (const backend of activeBackends) backend.destroy()
    activeBackends = []
  }

  const replaceCanvas = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
    const replacement = canvas.cloneNode(false) as HTMLCanvasElement
    canvas.replaceWith(replacement)
    return replacement
  }

  const resetCanvases = (): void => {
    // A luma WebGL device may explicitly lose its context when destroyed. A canvas cannot
    // reliably vend a fresh context afterwards, so every benchmark run gets fresh surfaces.
    webglCanvas = replaceCanvas(webglCanvas)
    webgpuCanvas = replaceCanvas(webgpuCanvas)
  }

  const updateControls = (): void => {
    const workload = workloadSelect.value as Workload
    const counts = workload === 'rendering' ? RENDER_COUNTS : SIMULATION_COUNTS
    countSelect.innerHTML = counts.map((count, index) =>
      `<option value="${count}" ${index === 1 ? 'selected' : ''}>${count.toLocaleString()}</option>`
    ).join('')
    diameterGroup.hidden = workload !== 'rendering'
    preview.hidden = workload !== 'rendering'
    lastReport = undefined
    exportButton.disabled = true
  }

  const setProgress = (completed: number, total: number, label: string): void => {
    progress.max = total
    progress.value = completed
    progressLabel.textContent = label
  }

  const renderResults = (report: PerformanceReport): void => {
    const completed = report.results.filter(result => result.status === 'complete')
    const fastest = Math.min(...completed
      .map(result => result.completion?.p50 ?? Infinity)
      .filter(value =>
        value > 0 &&
        value * report.parameters.iterationsPerSample >= MINIMUM_RELIABLE_BATCH_MILLISECONDS
      ))
    const rows = report.results.map(result => {
      if (result.status === 'unavailable') {
        return `
          <tr>
            <th scope="row">${result.backend}</th>
            <td colspan="7" class="benchmark-error">${escapeHtml(result.error ?? 'Unavailable')}</td>
          </tr>
        `
      }
      const timingIsReliable = Boolean(
        result.completion?.p50 &&
        result.completion.p50 * report.parameters.iterationsPerSample >=
          MINIMUM_RELIABLE_BATCH_MILLISECONDS
      )
      const relative = timingIsReliable && result.completion?.p50 && Number.isFinite(fastest)
        ? `${(result.completion.p50 / fastest).toFixed(2)}×`
        : 'timing floor'
      return `
        <tr>
          <th scope="row">${result.backend}</th>
          <td>${formatMilliseconds(result.setupMilliseconds)}</td>
          <td>${formatMilliseconds(result.submit?.p50)}</td>
          <td>${formatMilliseconds(result.submit?.p95)}</td>
          <td>${formatMilliseconds(result.completion?.p50)}</td>
          <td>${formatMilliseconds(result.completion?.p95)}</td>
          <td>${result.throughputMillionsPerSecond?.toFixed(2) ?? '—'} M/s · ${relative}</td>
          <td>${result.correctness ?? '—'}</td>
        </tr>
      `
    }).join('')

    resultsHost.innerHTML = `
      <div class="benchmark-result-heading">
        <div>
          <p class="eyebrow">${report.workload === 'rendering' ? 'Rendering' : 'Simulation primitive'}</p>
          <h2>${report.parameters.pointCount.toLocaleString()} points</h2>
        </div>
        <span>p50 / p95 across ${report.parameters.samples} synchronized samples</span>
      </div>
      <div class="benchmark-table-wrap">
        <table class="benchmark-table">
          <thead>
            <tr>
              <th>Backend</th><th>Setup</th><th>Submit p50</th><th>Submit p95</th>
              <th>Complete p50</th><th>Complete p95</th><th>Throughput / relative</th><th>Check</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
  }

  const createReport = (
    workload: Workload,
    pointCount: number,
    warmups: number,
    samples: number,
    iterationsPerSample: number,
    results: BackendReport[]
  ): PerformanceReport => ({
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    workload,
    timing: 'synchronized-completion-wall-time',
    parameters: {
      pointCount,
      diameter: workload === 'rendering' ? Number(diameterSelect.value) : undefined,
      warmupIterations: warmups,
      samples,
      iterationsPerSample,
    },
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio: window.devicePixelRatio,
      canvas: `${webglCanvas.width}×${webglCanvas.height}`,
    },
    results,
  })

  const runRendering = async (
    pointCount: number,
    warmups: number,
    samples: number,
    revision: number
  ): Promise<PerformanceReport> => {
    statusOutput.textContent = `Generating ${pointCount.toLocaleString()} shared points…`
    await nextFrame()
    const data = createPointData(pointCount, 0)
    const diameter = Number(diameterSelect.value)
    const batchSize = renderingBatchSize(pointCount)
    const slots: RenderSlot[] = [
      {
        name: 'WebGL 2',
        report: { backend: 'WebGL 2', status: 'complete', submitSamples: [], completionSamples: [] },
      },
      {
        name: 'WebGPU',
        report: { backend: 'WebGPU', status: 'complete', submitSamples: [], completionSamples: [] },
      },
    ]

    for (const slot of slots) {
      try {
        const started = performance.now()
        slot.backend = slot.name === 'WebGL 2'
          ? await createWebGLPointRenderer(webglCanvas)
          : await createWebGPUPointRenderer(webgpuCanvas, pointCount)
        slot.backend.setData(data)
        slot.report.setupMilliseconds = performance.now() - started
        activeBackends.push(slot.backend)
      } catch (error) {
        slot.report.status = 'unavailable'
        slot.report.error = error instanceof Error ? error.message : String(error)
      }
    }

    const available = slots.filter(slot => slot.backend)
    const total = available.length * (warmups + samples)
    let completed = 0
    for (let iteration = 0; iteration < warmups; iteration += 1) {
      for (const slot of available) {
        if (destroyed || revision !== runRevision) throw new Error('Benchmark cancelled')
        statusOutput.textContent = `Warming ${slot.name}…`
        await slot.backend?.measure(diameter, batchSize)
        completed += 1
        setProgress(completed, total, `Warm-up ${iteration + 1}/${warmups}`)
      }
    }

    for (let sample = 0; sample < samples; sample += 1) {
      const order = sample % 2 === 0 ? available : [...available].reverse()
      for (const slot of order) {
        if (destroyed || revision !== runRevision) throw new Error('Benchmark cancelled')
        statusOutput.textContent = `Measuring ${slot.name} · sample ${sample + 1}/${samples}…`
        const measurement = await slot.backend?.measure(diameter, batchSize)
        if (measurement) {
          slot.report.submitSamples.push(measurement.submitMilliseconds / batchSize)
          slot.report.completionSamples.push(measurement.completionMilliseconds / batchSize)
        }
        completed += 1
        setProgress(completed, total, `Sample ${sample + 1}/${samples}`)
      }
    }

    for (const slot of slots) {
      if (slot.report.status !== 'complete') continue
      slot.report.submit = summarizeSamples(slot.report.submitSamples)
      slot.report.completion = summarizeSamples(slot.report.completionSamples)
      if (slot.report.completion.p50 * batchSize >= MINIMUM_RELIABLE_BATCH_MILLISECONDS) {
        slot.report.throughputMillionsPerSecond =
          pointCount / (slot.report.completion.p50 * 1000)
      }
      slot.report.correctness = 'Rendered'
    }
    return createReport(
      'rendering',
      pointCount,
      warmups,
      samples,
      batchSize,
      slots.map(slot => slot.report)
    )
  }

  const runSimulation = async (
    pointCount: number,
    warmups: number,
    samples: number,
    revision: number
  ): Promise<PerformanceReport> => {
    const batchSize = simulationBatchSize(pointCount)
    const slots: SimulationSlot[] = [
      {
        name: 'WebGL 2',
        report: { backend: 'WebGL 2', status: 'complete', submitSamples: [], completionSamples: [] },
      },
      {
        name: 'WebGPU',
        report: { backend: 'WebGPU', status: 'complete', submitSamples: [], completionSamples: [] },
      },
    ]

    for (const slot of slots) {
      statusOutput.textContent = `Preparing ${slot.name} simulation resources…`
      await nextFrame()
      try {
        const started = performance.now()
        slot.backend = slot.name === 'WebGL 2'
          ? await createWebGLSimulationBenchmark(webglCanvas, pointCount)
          : await createWebGPUSimulationBenchmark(webgpuCanvas, pointCount)
        slot.report.setupMilliseconds = performance.now() - started
        activeBackends.push(slot.backend)
      } catch (error) {
        slot.report.status = 'unavailable'
        slot.report.error = error instanceof Error ? error.message : String(error)
      }
    }

    const available = slots.filter(slot => slot.backend)
    const total = available.length * (warmups + samples)
    let completed = 0
    for (let iteration = 0; iteration < warmups; iteration += 1) {
      for (const slot of available) {
        if (destroyed || revision !== runRevision) throw new Error('Benchmark cancelled')
        statusOutput.textContent = `Warming ${slot.name} reduction…`
        await slot.backend?.benchmark(batchSize)
        completed += 1
        setProgress(completed, total, `Warm-up ${iteration + 1}/${warmups}`)
      }
    }

    for (let sample = 0; sample < samples; sample += 1) {
      const order = sample % 2 === 0 ? available : [...available].reverse()
      for (const slot of order) {
        if (destroyed || revision !== runRevision) throw new Error('Benchmark cancelled')
        statusOutput.textContent = `Measuring ${slot.name} · sample ${sample + 1}/${samples}…`
        const measurement = await slot.backend?.benchmark(batchSize)
        if (measurement) {
          slot.report.submitSamples.push(measurement.submitMilliseconds / batchSize)
          slot.report.completionSamples.push(measurement.totalMilliseconds / batchSize)
        }
        completed += 1
        setProgress(completed, total, `Sample ${sample + 1}/${samples}`)
      }
    }

    const cpuCenter = calculateInitialCpuCenter(pointCount)
    for (const slot of slots) {
      if (slot.report.status !== 'complete' || !slot.backend) continue
      slot.report.submit = summarizeSamples(slot.report.submitSamples)
      slot.report.completion = summarizeSamples(slot.report.completionSamples)
      if (slot.report.completion.p50 * batchSize >= MINIMUM_RELIABLE_BATCH_MILLISECONDS) {
        slot.report.throughputMillionsPerSecond =
          pointCount / (slot.report.completion.p50 * 1000)
      }
      const center = await slot.backend.readCenter()
      slot.report.correctness = cpuCenter
        ? `error ${centerDistance(center, cpuCenter).toExponential(2)}`
        : 'CPU check skipped'
    }
    return createReport(
      'simulation',
      pointCount,
      warmups,
      samples,
      batchSize,
      slots.map(slot => slot.report)
    )
  }

  const run = async (): Promise<void> => {
    runRevision += 1
    const revision = runRevision
    destroyBackends()
    resetCanvases()
    runButton.disabled = true
    exportButton.disabled = true
    workloadSelect.disabled = true
    countSelect.disabled = true
    diameterSelect.disabled = true
    presetSelect.disabled = true
    resultsHost.innerHTML = '<div class="benchmark-empty"><p>Preparing benchmark resources…</p></div>'
    const workload = workloadSelect.value as Workload
    const pointCount = Number(countSelect.value)
    const preset = presetSelect.value as BenchmarkPreset
    const shape = benchmarkShape(preset)
    setProgress(0, 1, 'Preparing')

    try {
      const report = workload === 'rendering'
        ? await runRendering(pointCount, shape.warmups, shape.samples, revision)
        : await runSimulation(pointCount, shape.warmups, shape.samples, revision)
      if (destroyed || revision !== runRevision) return
      lastReport = report
      renderResults(report)
      statusOutput.textContent = 'Benchmark complete.'
      progressLabel.textContent = `${shape.samples} samples complete`
      exportButton.disabled = false
    } catch (error) {
      if (destroyed || revision !== runRevision) return
      statusOutput.textContent = error instanceof Error ? error.message : String(error)
      progressLabel.textContent = 'Failed'
      resultsHost.innerHTML = '<div class="benchmark-empty benchmark-error"><p>Benchmark did not complete.</p></div>'
    } finally {
      if (!destroyed && revision === runRevision) {
        runButton.disabled = false
        workloadSelect.disabled = false
        countSelect.disabled = false
        diameterSelect.disabled = false
        presetSelect.disabled = false
      }
    }
  }

  workloadSelect.addEventListener('change', updateControls)
  runButton.addEventListener('click', () => {
    run().catch(error => console.error(error))
  })
  exportButton.addEventListener('click', () => {
    if (!lastReport) return
    const blob = new Blob([JSON.stringify({ ...lastReport, gpuApi: 'luma-resources-v1' }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `cosmos-${lastReport.workload}-benchmark-${lastReport.parameters.pointCount}.json`
    link.click()
    URL.revokeObjectURL(url)
  })

  updateControls()

  return {
    destroy (): void {
      if (destroyed) return
      destroyed = true
      runRevision += 1
      destroyBackends()
      host.replaceChildren()
    },
  }
}
