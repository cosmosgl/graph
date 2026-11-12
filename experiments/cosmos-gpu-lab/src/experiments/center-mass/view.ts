import { scientific, milliseconds } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout, summarizeRun } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
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

export async function createCenterMassExperiment (host: HTMLElement): Promise<ExperimentInstance> {
  let runError: string | undefined
  host.innerHTML = `
    <section class="center-mass-demo">
      <div class="demo-toolbar"
      data-run-part="configuration">
        <div>
          <p class="eyebrow">Synchronized input</p>
          <p>The same ${POINT_COUNT.toLocaleString('en-US')} moving points are sent to both backends.</p>
        </div>
        <div class="controls">
          <button class="button-primary" data-action="step" type="button" disabled
      data-run-action="primary">Step</button>
          <button data-action="play" type="button" disabled
      data-run-action="primary">Play</button>
          <button data-action="reset" type="button" disabled
      data-run-action="primary">Reset</button>
        </div>
      </div>

      <section class="summary" aria-live="polite"
      data-run-part="results">
        <span>Tick <strong data-output="tick">0</strong></span>
        <span>CPU reference <strong data-output="cpu-center">—</strong></span>
        <span>Backend delta <strong data-output="backend-delta">—</strong></span>
      </section>

      <section
      data-run-part="visualization" class="backend-panels">
        <article class="backend-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Cosmos/WebGL approach</p>
              <h2>RGBA32F additive blend</h2>
            </div>
            <span data-status="webgl" class="status">Starting…</span>
          </div>
          <canvas data-canvas="webgl" width="420" height="320"></canvas>
          <dl>
            <div><dt>Center</dt><dd data-output="webgl-center">—</dd></div>
            <div><dt>Error vs CPU</dt><dd data-output="webgl-error">—</dd></div>
            <div><dt>Tick + readback</dt><dd data-output="webgl-time">—</dd></div>
          </dl>
        </article>

        <article class="backend-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">WebGPU approach</p>
              <h2>Two-stage workgroup reduction</h2>
            </div>
            <span data-status="webgpu" class="status">Starting…</span>
          </div>
          <canvas data-canvas="webgpu" width="420" height="320"></canvas>
          <dl>
            <div><dt>Center</dt><dd data-output="webgpu-center">—</dd></div>
            <div><dt>Error vs CPU</dt><dd data-output="webgpu-error">—</dd></div>
            <div><dt>Tick + readback</dt><dd data-output="webgpu-time">—</dd></div>
          </dl>
        </article>
      </section>

      <p class="demo-note"
      data-run-part="explanation">
        Red square = GPU-computed center. Timing includes upload, execution, synchronization,
        readback and drawing; use the Results and Performance sections for interpretation.
      </p>
    </section>
  `

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
  let destroyed = false
  let playTimer: number | undefined

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
    if (isRunning || destroyed) return
    isRunning = true
    stepButton.disabled = true
    resetButton.disabled = true

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
      if (!destroyed) {
        stepButton.disabled = false
        resetButton.disabled = false
      }
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

  stepButton.addEventListener('click', () => {
    runTick(true).catch(reportUnexpectedError)
  })
  playButton.addEventListener('click', () => {
    isPlaying = !isPlaying
    playButton.textContent = isPlaying ? 'Pause' : 'Play'
    playButton.setAttribute('aria-pressed', String(isPlaying))
    if (isPlaying) element<HTMLElement>(host, '.center-mass-demo').scrollIntoView({ block: 'start' })
    schedulePlay()
  })
  resetButton.addEventListener('click', () => {
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
    isPlaying || isRunning ? 'Running' : slots.some(s => s.backend) ? 'Ready' : 'Preparing',
    [],
    'Center accuracy budget and rendered-pixel parity.',
    slots.filter(s => s.error).map(s => s.id),
    runError), { experiment: 'center-mass', devices: () => slots.flatMap(s => s.backend?.info ? [s.backend.info] : []) })
  await Promise.all(constructors.map(async ({ slot, create }) => {
    try {
      slot.backend = await create()
      setStatus(slot.id, 'Ready')
    } catch (error) {
      runError = String(error)
      slot.error = error instanceof Error ? error.message : String(error)
      setStatus(slot.id, 'Unavailable', true)
      element<HTMLElement>(host, `[data-output="${slot.id}-center"]`).textContent = slot.error
    }
  }))

  await runTick(false)
  playButton.disabled = false

  return {
    pause (): void {
      isPlaying = false; window.clearTimeout(playTimer)
      playButton.textContent = 'Play'; playButton.setAttribute('aria-pressed', 'false')
    },
    destroy (): void {
      disposeRunLayout(host)
      if (destroyed) return
      destroyed = true
      isPlaying = false
      window.clearTimeout(playTimer)
      for (const slot of slots) slot.backend?.destroy()
      host.replaceChildren()
    },
  }
}
