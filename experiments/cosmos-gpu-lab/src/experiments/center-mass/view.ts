import { scientific, milliseconds } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout, summarizeRun } from '../../runtime/run-layout'
import type { ExperimentInstance, ExperimentStartOptions } from '../../runtime/experiment'
import type { BackendResult, CenterMassBackend } from './backend'
import {
  advancePointState,
  calculateCpuCenter,
  createPointState,
  POINT_COUNT,
  type Center,
  type PointState,
} from './point-state'
import { createWebGLCenterMass } from './webgl/backend'
import { createWebGPUCenterMass } from './webgpu/backend'
import { mountCenterScale } from './scale-view'
import { mountCenterOnce } from './center-once-view'

type BackendSlot = {
  id: 'webgl' | 'webgpu';
  backend?: CenterMassBackend;
  error?: string;
}

function element<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const found = host.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

function reportUnexpectedError (error: unknown): void {
  console.error(error)
}

function formatCenter (center: Center): string {
  return `${center.x.toFixed(7)}, ${center.y.toFixed(7)}`
}

function centerDistance (left: Center, right: Center): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

export async function createCenterMassExperiment (host: HTMLElement, { deferComparison = false }: ExperimentStartOptions = {}): Promise<ExperimentInstance> {
  let runError: string | undefined
  host.classList.add('center-mass-run')
  host.innerHTML = `
    <section class="center-mass-demo">
      <div class="demo-toolbar"
      data-run-part="configuration">
        <div>
          <p class="eyebrow">Starting case</p>
          <p>Reset restores the same starting positions.</p>
        </div>
        <div class="controls">
          <button class="button-primary" data-action="initialize" type="button" hidden
      data-run-action="primary">Start the live comparison</button>
          <button class="button-primary" data-action="step" type="button" disabled
      data-run-action="primary">Step</button>
          <button data-action="play" type="button" disabled
      data-run-action="primary">Play</button>
          <button data-action="reset" type="button" disabled
      data-run-action="primary">Reset</button>
        </div>
      </div>

      <p class="demo-note" data-run-part="status">Each yellow square marks a GPU center. Errors are distances to the CPU center.</p>

      <section class="summary center-readout" aria-label="Center errors" aria-live="polite" data-run-part="visualization">
        <span>Tick <strong data-output="tick">0</strong></span>
        <span>WebGL error <strong data-output="webgl-error">—</strong></span>
        <span>WebGPU error <strong data-output="webgpu-error">—</strong></span>
      </section>

      <section
      data-run-part="visualization" class="backend-panels">
        <article class="backend-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Cosmos-style calculation</p>
              <h2>WebGL · additive blending</h2>
            </div>
            <span data-status="webgl" class="status">Starting…</span>
          </div>
          <canvas data-canvas="webgl" width="420" height="320" role="img" aria-label="WebGL points and calculated center"></canvas>
          <dl>
            <div><dt>Center</dt><dd data-output="webgl-center">—</dd></div>
            <div><dt>Tick + readback</dt><dd data-output="webgl-time">—</dd></div>
          </dl>
        </article>

        <article class="backend-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Compute calculation</p>
              <h2>WebGPU · two-stage reduction</h2>
            </div>
            <span data-status="webgpu" class="status">Starting…</span>
          </div>
          <canvas data-canvas="webgpu" width="420" height="320" role="img" aria-label="WebGPU points and calculated center"></canvas>
          <dl>
            <div><dt>Center</dt><dd data-output="webgpu-center">—</dd></div>
            <div><dt>Tick + readback</dt><dd data-output="webgpu-time">—</dd></div>
          </dl>
        </article>
      </section>

      <div class="summary" data-run-part="visualization">
        <span>CPU center <strong data-output="cpu-center">—</strong></span>
        <span>Difference between GPU centers <strong data-output="backend-delta">—</strong></span>
      </div>
      <p class="demo-note" data-run-part="visualization">
        This demo has no accuracy pass threshold. Tick time includes upload, execution, synchronization, readback and drawing.
      </p>
      <details class="advanced-controls" data-run-part="diagnostics">
        <summary>Run local measurements</summary>
        <section data-center-scale></section>
        <section data-center-once></section>
      </details>
    </section>
  `

  const startButton = element<HTMLButtonElement>(host, '[data-action="initialize"]')
  const stepButton = element<HTMLButtonElement>(host, '[data-action="step"]')
  const playButton = element<HTMLButtonElement>(host, '[data-action="play"]')
  const resetButton = element<HTMLButtonElement>(host, '[data-action="reset"]')
  const tickOutput = element<HTMLElement>(host, '[data-output="tick"]')
  const cpuOutput = element<HTMLElement>(host, '[data-output="cpu-center"]')
  const deltaOutput = element<HTMLElement>(host, '[data-output="backend-delta"]')
  const slots: BackendSlot[] = [{ id: 'webgl' }, { id: 'webgpu' }]

  let pointState: PointState = createPointState()
  let tick = 0
  let isPlaying = false
  let isRunning = false
  let isMeasuring = false
  let isInitializing = false
  let started = false
  let destroyed = false
  let playTimer: number | undefined

  const updateButtons = (): void => {
    startButton.disabled = isInitializing || isMeasuring
    playButton.disabled = !started || isMeasuring
    stepButton.disabled = resetButton.disabled = playButton.disabled || isRunning
  }

  const setStatus = (id: BackendSlot['id'], message: string, failed = false): void => {
    const status = element<HTMLElement>(host, `[data-status="${id}"]`)
    status.textContent = message
    status.classList.toggle('failed', failed)
  }

  const showResult = (id: BackendSlot['id'], result: BackendResult, cpuCenter: Center): void => {
    element<HTMLElement>(host, `[data-output="${id}-center"]`).textContent = formatCenter(result.center)
    element<HTMLElement>(host, `[data-output="${id}-error"]`).textContent = scientific(centerDistance(
      result.center,
      cpuCenter
    ), 3)
    element<HTMLElement>(host, `[data-output="${id}-time"]`).textContent =
      `${milliseconds(result.elapsedMilliseconds)} ms`
  }

  const runTick = async (advance: boolean): Promise<void> => {
    if (isRunning || isMeasuring || destroyed) return
    isRunning = true
    updateButtons()

    try {
      if (advance) {
        advancePointState(pointState)
        tick += 1
      }

      const cpuCenter = calculateCpuCenter(pointState.positions)
      tickOutput.textContent = String(tick)
      cpuOutput.textContent = formatCenter(cpuCenter)

      const results = new Map<BackendSlot['id'], BackendResult>()
      for (const slot of slots) {
        if (!slot.backend) continue
        try {
          const result = await slot.backend.run(pointState.positions)
          if (destroyed) return
          results.set(slot.id, result)
          showResult(slot.id, result, cpuCenter)
        } catch (error) {
          if (destroyed) return
          runError = String(error)
          slot.error = error instanceof Error ? error.message : String(error)
          setStatus(slot.id, 'Runtime error', true)
          element<HTMLElement>(host, `[data-output="${slot.id}-center"]`).textContent = slot.error
          slot.backend.destroy()
          slot.backend = undefined
        }
      }

      const webgl = results.get('webgl')
      const webgpu = results.get('webgpu')
      deltaOutput.textContent = webgl && webgpu
        ? scientific(centerDistance(webgl.center, webgpu.center), 3)
        : 'Unavailable'
    } finally {
      isRunning = false
      if (!destroyed) updateButtons()
    }
  }

  const schedulePlay = (): void => {
    window.clearTimeout(playTimer)
    if (!isPlaying || destroyed) return
    playTimer = window.setTimeout(() => {
      runTick(true)
        .then(schedulePlay)
        .catch(reportUnexpectedError)
    }, 120)
  }

  const setPlayback = (playing: boolean): void => {
    isPlaying = playing
    playButton.textContent = playing ? 'Pause' : 'Play'
    playButton.setAttribute('aria-pressed', String(playing))
    if (!playing) window.clearTimeout(playTimer)
  }

  stepButton.addEventListener('click', () => {
    runTick(true).catch(reportUnexpectedError)
  })
  playButton.addEventListener('click', () => {
    if (isMeasuring || destroyed) return
    setPlayback(!isPlaying)
    if (isPlaying) element<HTMLElement>(host, '.run-primary-actions').scrollIntoView({ block: 'start' })
    schedulePlay()
  })
  resetButton.addEventListener('click', () => {
    if (isRunning || isMeasuring || destroyed) return
    pointState = createPointState()
    tick = 0
    runTick(false).catch(reportUnexpectedError)
  })

  const constructors: Array<{
    slot: BackendSlot;
    create: () => Promise<CenterMassBackend>;
  }> = [
    {
      slot: slots[0],
      create: () => createWebGLCenterMass(element(host, '[data-canvas="webgl"]'), POINT_COUNT),
    },
    {
      slot: slots[1],
      create: () => createWebGPUCenterMass(element(host, '[data-canvas="webgpu"]'), POINT_COUNT),
    },
  ]

  mountRunLayout(host, () => summarizeRun(
    isMeasuring ? 'Measuring' : isPlaying || isRunning ? 'Running' : started ? 'Ready' : isInitializing ? 'Preparing' : 'Ready to start',
    [],
    'Center accuracy budget and rendered-pixel parity.',
    slots.filter(s => s.error).map(s => s.id),
    runError), {
    experiment: 'center-mass',
    devices: () => slots.flatMap(s => s.backend?.info ? [s.backend.info] : []),
    fixedOrder: true,
    showChecks: false,
    scope: 'The selected tick of one shared 8,192-point input; GPU centers are compared with the CPU average.',
  })
  const visualization = element(host, '.run-visualization')
  const guide = element(host, '[data-run-part="status"]')
  const liveControls = [stepButton, playButton, resetButton]
  const initialize = async (): Promise<void> => {
    if (started || isInitializing || isMeasuring || destroyed) return
    isInitializing = true; updateButtons()
    startButton.textContent = 'Starting comparison…'
    try {
      await Promise.all(constructors.map(async ({ slot, create }) => {
        try {
          const backend = await create()
          if (destroyed) { backend.destroy(); return }
          slot.backend = backend; setStatus(slot.id, 'Ready')
        } catch (error) {
          if (destroyed) return
          runError = String(error)
          slot.error = error instanceof Error ? error.message : String(error)
          setStatus(slot.id, 'Unavailable', true)
          element<HTMLElement>(host, `[data-output="${slot.id}-center"]`).textContent = slot.error
        }
      }))
      if (destroyed) return
      await runTick(false)
      if (destroyed) return
      started = true; startButton.hidden = true
      guide.hidden = visualization.hidden = false
      liveControls.forEach(control => { control.hidden = false })
    } finally {
      isInitializing = false
      if (!destroyed) updateButtons()
    }
  }
  const setMeasurement = (measuring: boolean): void => {
    isMeasuring = measuring
    updateButtons()
  }
  const begin = (): boolean => {
    if (isMeasuring || isRunning || isInitializing || destroyed) return false
    setPlayback(false)
    setMeasurement(true)
    return true
  }
  const end = (): void => { setMeasurement(false) }
  const scale = mountCenterScale(element(host, '[data-center-scale]'), begin, end)
  const once = mountCenterOnce(element(host, '[data-center-once]'), begin, end)
  if (deferComparison) {
    startButton.hidden = false
    guide.hidden = visualization.hidden = true
    liveControls.forEach(control => { control.hidden = true })
    startButton.addEventListener('click', () => { initialize().catch(reportUnexpectedError) })
  } else await initialize()
  return {
    pause (): void {
      setPlayback(false); scale.pause(); once.pause()
    },
    destroy (): void {
      disposeRunLayout(host)
      if (destroyed) return
      destroyed = true
      isPlaying = false
      window.clearTimeout(playTimer)
      scale.destroy(); once.destroy()
      for (const slot of slots) slot.backend?.destroy()
      host.replaceChildren()
    },
  }
}
