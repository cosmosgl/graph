import type { ExperimentInstance } from '../../runtime/experiment'
import {
  createScalableReductionBackend,
  formatBytes,
  type ReductionCenter,
  type ReductionRunResult,
  type ScalableReductionBackend,
} from './backend'
import {
  calculateInitialCpuCenter,
  CPU_REFERENCE_LIMIT,
  rotateCpuCenter,
} from './reference'

const POINT_PRESETS = [8_192, 65_536, 1_000_000, 10_000_000] as const
const DEFAULT_POINT_COUNT = 1_000_000

function element<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const found = host.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

function formatCenter (center: ReductionCenter): string {
  return `${center.x.toFixed(8)}, ${center.y.toFixed(8)}`
}

function centerDistance (left: ReductionCenter, right: ReductionCenter): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function nextFrame (): Promise<void> {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()))
}

function benchmarkIterations (pointCount: number): number {
  if (pointCount >= 10_000_000) return 5
  if (pointCount >= 1_000_000) return 20
  return 100
}

export async function createScalableReductionExperiment (
  host: HTMLElement
): Promise<ExperimentInstance> {
  host.innerHTML = `
    <section class="scalable-demo">
      <div class="scale-toolbar">
        <label>
          <span>Point count</span>
          <select data-control="point-count">
            ${POINT_PRESETS.map(count => `
              <option value="${count}" ${count === DEFAULT_POINT_COUNT ? 'selected' : ''}>
                ${count.toLocaleString()}
              </option>
            `).join('')}
          </select>
        </label>
        <label class="checkbox-control">
          <input data-control="readback" type="checkbox" checked>
          <span>Read center back to CPU</span>
        </label>
        <div class="controls">
          <button data-action="step" type="button" disabled>Step</button>
          <button data-action="play" type="button" disabled>Play</button>
          <button data-action="reset" type="button" disabled>Reset</button>
          <button data-action="benchmark" type="button" disabled>Benchmark</button>
        </div>
      </div>

      <section class="scale-status" aria-live="polite">
        <span data-output="status">Creating WebGPU resources…</span>
        <span>Tick <strong data-output="tick">0</strong></span>
      </section>

      <canvas class="scale-canvas" data-output="canvas" width="900" height="440"></canvas>

      <section class="scale-metrics">
        <div><span>Reduction hierarchy</span><strong data-output="hierarchy">—</strong></div>
        <div><span>Position storage</span><strong data-output="positions">—</strong></div>
        <div><span>Ping-pong partials</span><strong data-output="partials">—</strong></div>
        <div><span>Rendered sample</span><strong data-output="rendered">—</strong></div>
        <div><span>GPU center</span><strong data-output="center">—</strong></div>
        <div><span>CPU reference error</span><strong data-output="error">—</strong></div>
        <div><span data-output="timing-label">Tick + readback</span><strong data-output="timing">—</strong></div>
        <div><span>Reduction benchmark</span><strong data-output="benchmark">Not run</strong></div>
      </section>

      <p class="demo-note">
        Positions are generated, advanced, reduced and sampled for rendering on the GPU. Turning readback off keeps
        the center GPU-resident; the displayed tick time then measures command encoding and submission, not GPU completion.
      </p>
    </section>
  `

  const countSelect = element<HTMLSelectElement>(host, '[data-control="point-count"]')
  const readbackCheckbox = element<HTMLInputElement>(host, '[data-control="readback"]')
  const stepButton = element<HTMLButtonElement>(host, '[data-action="step"]')
  const playButton = element<HTMLButtonElement>(host, '[data-action="play"]')
  const resetButton = element<HTMLButtonElement>(host, '[data-action="reset"]')
  const benchmarkButton = element<HTMLButtonElement>(host, '[data-action="benchmark"]')
  const statusOutput = element<HTMLElement>(host, '[data-output="status"]')
  const tickOutput = element<HTMLElement>(host, '[data-output="tick"]')
  const centerOutput = element<HTMLElement>(host, '[data-output="center"]')
  const errorOutput = element<HTMLElement>(host, '[data-output="error"]')
  const timingOutput = element<HTMLElement>(host, '[data-output="timing"]')
  const timingLabel = element<HTMLElement>(host, '[data-output="timing-label"]')
  const benchmarkOutput = element<HTMLElement>(host, '[data-output="benchmark"]')
  const canvas = element<HTMLCanvasElement>(host, '[data-output="canvas"]')

  let backend: ScalableReductionBackend | undefined
  let cpuCenter: ReductionCenter | undefined
  let tick = 0
  let isRunning = false
  let isPlaying = false
  let destroyed = false
  let revision = 0
  let playTimer: number | undefined

  const setControlsDisabled = (disabled: boolean): void => {
    stepButton.disabled = disabled
    playButton.disabled = disabled
    resetButton.disabled = disabled
    benchmarkButton.disabled = disabled
    countSelect.disabled = disabled
  }

  const showResult = (result: ReductionRunResult): void => {
    timingLabel.textContent = result.timingKind === 'readback'
      ? 'Tick + readback'
      : 'CPU encode + submit'
    timingOutput.textContent = result.elapsedMilliseconds < 0.01
      ? '<0.01 ms'
      : `${result.elapsedMilliseconds.toFixed(2)} ms`
    if (!result.center) {
      centerOutput.textContent = 'GPU resident · no readback'
      errorOutput.textContent = 'Not sampled'
      return
    }
    centerOutput.textContent = formatCenter(result.center)
    errorOutput.textContent = cpuCenter
      ? centerDistance(result.center, cpuCenter).toExponential(3)
      : `CPU reference skipped above ${CPU_REFERENCE_LIMIT.toLocaleString()} points`
  }

  const runTick = async (advance: boolean): Promise<void> => {
    if (!backend || isRunning || destroyed) return
    isRunning = true
    stepButton.disabled = true
    resetButton.disabled = true
    benchmarkButton.disabled = true
    try {
      if (advance) {
        tick += 1
        if (cpuCenter) cpuCenter = rotateCpuCenter(cpuCenter)
      }
      const result = await backend.run(advance, readbackCheckbox.checked)
      if (destroyed) return
      tickOutput.textContent = String(tick)
      showResult(result)
    } finally {
      isRunning = false
      if (!destroyed) {
        stepButton.disabled = false
        resetButton.disabled = false
        benchmarkButton.disabled = false
      }
    }
  }

  const schedulePlay = (): void => {
    window.clearTimeout(playTimer)
    if (!isPlaying || destroyed) return
    playTimer = window.setTimeout(() => {
      runTick(true)
        .then(schedulePlay)
        .catch(error => {
          statusOutput.textContent = error instanceof Error ? error.message : String(error)
          isPlaying = false
          playButton.textContent = 'Play'
        })
    }, 100)
  }

  const configure = async (): Promise<void> => {
    revision += 1
    const configurationRevision = revision
    isPlaying = false
    playButton.textContent = 'Play'
    window.clearTimeout(playTimer)
    backend?.destroy()
    backend = undefined
    setControlsDisabled(true)
    isRunning = true
    tick = 0
    tickOutput.textContent = '0'
    benchmarkOutput.textContent = 'Not run'
    centerOutput.textContent = '—'
    errorOutput.textContent = '—'
    timingOutput.textContent = '—'
    const pointCount = Number(countSelect.value)
    statusOutput.textContent = `Allocating ${pointCount.toLocaleString()} GPU-resident points…`
    await nextFrame()

    try {
      cpuCenter = calculateInitialCpuCenter(pointCount)
      const createdBackend = await createScalableReductionBackend(canvas, pointCount)
      if (configurationRevision !== revision || destroyed) {
        createdBackend.destroy()
        return
      }
      backend = createdBackend
      element<HTMLElement>(host, '[data-output="hierarchy"]').textContent =
        createdBackend.reductionCounts.map(count => count.toLocaleString()).join(' → ')
      element<HTMLElement>(host, '[data-output="positions"]').textContent =
        formatBytes(createdBackend.positionBytes)
      element<HTMLElement>(host, '[data-output="partials"]').textContent =
        formatBytes(createdBackend.partialBytes)
      element<HTMLElement>(host, '[data-output="rendered"]').textContent =
        `${createdBackend.renderedPointCount.toLocaleString()} of ${pointCount.toLocaleString()}`
      const result = await createdBackend.run(false, readbackCheckbox.checked)
      if (configurationRevision !== revision || destroyed) return
      showResult(result)
      statusOutput.textContent = `Ready · ${createdBackend.reductionCounts.length - 1} reduction passes`
    } catch (error) {
      if (configurationRevision !== revision || destroyed) return
      statusOutput.textContent = error instanceof Error ? error.message : String(error)
      statusOutput.classList.add('failed')
    } finally {
      if (configurationRevision === revision && !destroyed) {
        isRunning = false
        setControlsDisabled(!backend)
      }
    }
  }

  stepButton.addEventListener('click', () => {
    runTick(true).catch(error => {
      statusOutput.textContent = error instanceof Error ? error.message : String(error)
    })
  })
  playButton.addEventListener('click', () => {
    isPlaying = !isPlaying
    playButton.textContent = isPlaying ? 'Pause' : 'Play'
    schedulePlay()
  })
  resetButton.addEventListener('click', () => {
    configure().catch(error => {
      statusOutput.textContent = error instanceof Error ? error.message : String(error)
    })
  })
  countSelect.addEventListener('change', () => {
    statusOutput.classList.remove('failed')
    configure().catch(error => {
      statusOutput.textContent = error instanceof Error ? error.message : String(error)
    })
  })
  benchmarkButton.addEventListener('click', async () => {
    if (!backend || isRunning) return
    isRunning = true
    setControlsDisabled(true)
    const iterations = benchmarkIterations(backend.pointCount)
    benchmarkOutput.textContent = `Running ${iterations} iterations…`
    try {
      const result = await backend.benchmark(iterations)
      benchmarkOutput.textContent =
        `${result.averageMilliseconds.toFixed(2)} ms average · ${result.totalMilliseconds.toFixed(1)} ms total`
    } catch (error) {
      benchmarkOutput.textContent = error instanceof Error ? error.message : String(error)
    } finally {
      isRunning = false
      if (!destroyed) setControlsDisabled(false)
    }
  })

  await configure()

  return {
    destroy (): void {
      if (destroyed) return
      destroyed = true
      revision += 1
      isPlaying = false
      window.clearTimeout(playTimer)
      backend?.destroy()
      backend = undefined
      host.replaceChildren()
    },
  }
}
