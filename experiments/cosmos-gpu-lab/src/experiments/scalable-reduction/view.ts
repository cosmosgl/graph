import { milliseconds, scientific } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
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
const DEFAULT_POINT_COUNT = 8_192

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
      <div data-run-part="configuration" class="reduction-settings">
        <div class="choice-control" role="group" aria-label="Point count" data-control="point-count">
          <span class="choice-label">Points</span>
          <div class="choice-options">
            ${POINT_PRESETS.map(count => `<button type="button" value="${count}" aria-pressed="${count === DEFAULT_POINT_COUNT}">
              ${count >= 1_000_000 ? `${count / 1_000_000}M` : count.toLocaleString('en-US')}</button>`).join('')}
          </div>
        </div>
        <label class="checkbox-control">
          <input data-control="readback" type="checkbox" checked>
          <span>Copy center to CPU</span>
        </label>
        <div class="controls">
          <span class="tick-counter">Tick <strong data-output="tick">0</strong></span>
          <button class="button-primary" data-action="step" type="button" disabled
      data-run-action="primary">Step</button>
          <button data-action="play" type="button" disabled
      data-run-action="primary">Play</button>
          <button data-action="reset" type="button" disabled
      data-run-action="primary">Reset</button>
        </div>
      </div>

      <div class="reduction-preview" data-run-part="visualization">
        <canvas class="scale-canvas" data-output="canvas" width="900" height="440" aria-label="Point sample and its center"></canvas>
        <p role="status" data-output="status">Creating WebGPU resources…</p>
        <p class="reduction-specs" data-output="specs"></p>
        <dl class="reduction-readouts" id="run-results" aria-label="Latest tick">
          <div><dt>Reduced count</dt><dd data-output="count">—</dd></div>
          <div><dt>GPU center</dt><dd data-output="center">—</dd></div>
          <div><dt>CPU error</dt><dd data-output="error">—</dd></div>
          <div><dt data-output="timing-label">Tick + readback</dt><dd data-output="timing">—</dd></div>
        </dl>
        <div class="controls reduction-benchmark" id="reduction-benchmark">
          <button data-action="benchmark" type="button" disabled>Benchmark</button>
          <output data-output="benchmark"></output>
        </div>
      </div>
    </section>
  `

  const presets = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-control="point-count"] button'))
  const readbackCheckbox = element<HTMLInputElement>(host, '[data-control="readback"]')
  const stepButton = element<HTMLButtonElement>(host, '[data-action="step"]')
  const playButton = element<HTMLButtonElement>(host, '[data-action="play"]')
  const resetButton = element<HTMLButtonElement>(host, '[data-action="reset"]')
  const benchmarkButton = element<HTMLButtonElement>(host, '[data-action="benchmark"]')
  const statusOutput = element<HTMLElement>(host, '[data-output="status"]')
  const tickOutput = element<HTMLElement>(host, '[data-output="tick"]')
  const countOutput = element<HTMLElement>(host, '[data-output="count"]')
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
  let pending: Promise<void> = Promise.resolve()
  let playTimer: number | undefined
  let pointCount: number = DEFAULT_POINT_COUNT
  const specsOutput = element<HTMLElement>(host, '[data-output="specs"]')

  const stopPlayback = (): void => {
    isPlaying = false
    window.clearTimeout(playTimer)
    playButton.textContent = 'Play'
    playButton.setAttribute('aria-pressed', 'false')
  }

  const updateControls = (): void => {
    for (const button of presets) {
      button.disabled = isRunning
      button.setAttribute('aria-pressed', String(Number(button.value) === pointCount))
    }
    stepButton.disabled = isRunning || !backend
    playButton.disabled = !backend || (isRunning && !isPlaying)
    resetButton.disabled = isRunning
    benchmarkButton.disabled = isRunning || !backend
    readbackCheckbox.disabled = isRunning
  }

  const release = async (): Promise<void> => {
    const current = backend
    backend = undefined
    if (current) {
      try { await current.waitForIdle() } finally { current.destroy() }
    }
  }

  const perform = (operation: () => Promise<void>, resetOnFailure: boolean): Promise<void> => {
    if (destroyed || isRunning) return pending
    isRunning = true
    const feedback = resetOnFailure ? statusOutput : benchmarkOutput
    feedback.classList.remove('failed')
    updateControls()
    pending = operation().catch(async (error: unknown) => {
      if (destroyed) return
      stopPlayback()
      feedback.textContent = error instanceof Error ? error.message : String(error)
      feedback.classList.add('failed')
      // A failed readback can follow a submitted rotation. Restart from known positions.
      if (resetOnFailure) await release().catch(() => {})
    }).finally(() => {
      isRunning = false
      if (!destroyed) updateControls()
    })
    return pending
  }

  const showResult = (result: ReductionRunResult, reference?: ReductionCenter): void => {
    timingLabel.textContent = result.timingKind === 'readback'
      ? 'Tick + readback'
      : 'CPU encode + submit'
    timingOutput.textContent = result.elapsedMilliseconds < 0.01
      ? '<0.01 ms'
      : `${milliseconds(result.elapsedMilliseconds)} ms`
    if (!result.center) {
      countOutput.textContent = 'Not sampled'
      centerOutput.textContent = 'On GPU'
      statusOutput.textContent = 'Center kept on GPU this tick.'
      errorOutput.textContent = 'Not sampled'
      return
    }
    countOutput.textContent = result.center.count.toLocaleString('en-US')
    centerOutput.textContent = formatCenter(result.center)
    errorOutput.textContent = reference
      ? scientific(centerDistance(result.center, reference), 3)
      : `Skipped above ${CPU_REFERENCE_LIMIT.toLocaleString('en-US', { notation: 'compact' })}`
    const countMatches = result.center.count === pointCount
    const finiteCenter = Number.isFinite(result.center.x) && Number.isFinite(result.center.y)
    if (!countMatches) throw new Error(`Reduced ${result.center.count} of ${pointCount} points`)
    if (!finiteCenter) throw new Error('The reduced center has a non-finite coordinate')
    statusOutput.textContent = 'Count matched. Center is finite.'
  }

  const runTick = (): Promise<void> => perform(async () => {
    if (!backend) return
    const result = await backend.run(true, readbackCheckbox.checked)
    if (destroyed) return
    const nextCenter = cpuCenter && rotateCpuCenter(cpuCenter)
    showResult(result, nextCenter)
    cpuCenter = nextCenter
    tick += 1
    tickOutput.textContent = String(tick)
  }, true)

  const schedulePlay = (): void => {
    window.clearTimeout(playTimer)
    if (isPlaying && !destroyed) playTimer = window.setTimeout(() => { runTick().then(schedulePlay) }, 100)
  }

  const configure = (): Promise<void> => perform(async () => {
    stopPlayback()
    tick = 0
    tickOutput.textContent = '0'
    benchmarkOutput.textContent = ''
    specsOutput.textContent = ''
    for (const name of ['count', 'center', 'error', 'timing']) {
      element(host, `[data-output="${name}"]`).textContent = '—'
    }
    statusOutput.textContent = `Preparing ${pointCount.toLocaleString('en-US')} points…`
    await release()
    if (destroyed) return
    backend = await createScalableReductionBackend(canvas, pointCount)
    if (destroyed) return
    cpuCenter = pointCount <= CPU_REFERENCE_LIMIT ? calculateInitialCpuCenter(pointCount) : undefined
    const result = await backend.run(false, readbackCheckbox.checked)
    if (destroyed) return
    showResult(result, cpuCenter)
    const levels = backend.reductionCounts.map(count => count.toLocaleString('en-US')).join(' → ')
    specsOutput.textContent = `${levels} · ${formatBytes(backend.positionBytes)} positions · ` +
      `${formatBytes(backend.partialBytes)} partials · ${backend.renderedPointCount.toLocaleString('en-US')} drawn`
  }, true)

  stepButton.addEventListener('click', () => { stopPlayback(); runTick() })
  playButton.addEventListener('click', () => {
    if (isPlaying) { stopPlayback(); updateControls(); return }
    isPlaying = true
    playButton.textContent = 'Pause'
    playButton.setAttribute('aria-pressed', 'true')
    schedulePlay()
  })
  resetButton.addEventListener('click', () => { configure() })
  for (const button of presets) {
    button.addEventListener('click', () => {
      pointCount = Number(button.value)
      configure()
    })
  }
  benchmarkButton.addEventListener('click', () => {
    stopPlayback()
    perform(async () => {
      if (!backend) return
      const iterations = benchmarkIterations(pointCount)
      benchmarkOutput.textContent = `Running ${iterations} reductions…`
      const result = await backend.benchmark(iterations)
      if (destroyed) return
      benchmarkOutput.textContent = `${milliseconds(result.averageMilliseconds)} ms per reduction · ${iterations} iterations`
    }, false)
  })

  mountRunLayout(host)
  await configure()

  return {
    pause: stopPlayback,
    destroy (): void {
      if (destroyed) return
      destroyed = true
      stopPlayback()
      disposeRunLayout(host)
      pending.then(release).catch(() => {})
      host.replaceChildren()
    },
  }
}
