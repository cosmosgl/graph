import './styles.css'
import type { BackendResult, CenterMassBackend } from './backend'
import {
  advancePointState,
  calculateCpuCenter,
  createPointState,
  POINT_COUNT,
  type Center,
  type PointState,
} from './point-state'
import { createWebGLCenterMass } from './webgl-center-mass'
import { createWebGPUCenterMass } from './webgpu-center-mass'

type BackendSlot = {
  id: 'webgl' | 'webgpu';
  backend?: CenterMassBackend;
  error?: string;
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

app.innerHTML = `
  <main>
    <header>
      <div>
        <p class="eyebrow">cosmos.gl experiment</p>
        <h1>Global center of mass</h1>
        <p class="description">The same ${POINT_COUNT.toLocaleString()} moving points, accumulated by two GPU paths.</p>
      </div>
      <div class="controls">
        <button id="step" type="button">Step</button>
        <button id="play" type="button">Play</button>
        <button id="reset" type="button">Reset</button>
      </div>
    </header>

    <section class="summary" aria-live="polite">
      <span>Tick <strong id="tick">0</strong></span>
      <span>CPU reference <strong id="cpu-center">—</strong></span>
      <span>Backend delta <strong id="backend-delta">—</strong></span>
    </section>

    <section class="panels">
      <article>
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Cosmos/WebGL approach</p>
            <h2>RGBA32F additive blend</h2>
          </div>
          <span id="webgl-status" class="status">Starting…</span>
        </div>
        <canvas id="webgl-canvas" width="420" height="320"></canvas>
        <dl>
          <div><dt>Center</dt><dd id="webgl-center">—</dd></div>
          <div><dt>Error vs CPU</dt><dd id="webgl-error">—</dd></div>
          <div><dt>Tick + readback</dt><dd id="webgl-time">—</dd></div>
        </dl>
      </article>

      <article>
        <div class="panel-heading">
          <div>
            <p class="eyebrow">WebGPU approach</p>
            <h2>Two-stage workgroup reduction</h2>
          </div>
          <span id="webgpu-status" class="status">Starting…</span>
        </div>
        <canvas id="webgpu-canvas" width="420" height="320"></canvas>
        <dl>
          <div><dt>Center</dt><dd id="webgpu-center">—</dd></div>
          <div><dt>Error vs CPU</dt><dd id="webgpu-error">—</dd></div>
          <div><dt>Tick + readback</dt><dd id="webgpu-time">—</dd></div>
        </dl>
      </article>
    </section>

    <p class="note">
      Red square = GPU-computed center. Timing includes upload, execution, synchronization,
      readback, and drawing; it is a correctness comparison, not a pure kernel benchmark.
    </p>
  </main>
`

function element<T extends HTMLElement> (selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

function reportUnexpectedError (error: unknown): void {
  console.error(error)
}

const stepButton = element<HTMLButtonElement>('#step')
const playButton = element<HTMLButtonElement>('#play')
const resetButton = element<HTMLButtonElement>('#reset')
const tickOutput = element<HTMLElement>('#tick')
const cpuOutput = element<HTMLElement>('#cpu-center')
const deltaOutput = element<HTMLElement>('#backend-delta')

const slots: BackendSlot[] = [
  { id: 'webgl' },
  { id: 'webgpu' },
]

let pointState: PointState = createPointState()
let tick = 0
let isPlaying = false
let isRunning = false
let playTimer: number | undefined

function formatCenter (center: Center): string {
  return `${center.x.toFixed(7)}, ${center.y.toFixed(7)}`
}

function centerDistance (left: Center, right: Center): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function setStatus (id: BackendSlot['id'], message: string, failed = false): void {
  const status = element<HTMLElement>(`#${id}-status`)
  status.textContent = message
  status.classList.toggle('failed', failed)
}

function showResult (id: BackendSlot['id'], result: BackendResult, cpuCenter: Center): void {
  element<HTMLElement>(`#${id}-center`).textContent = formatCenter(result.center)
  element<HTMLElement>(`#${id}-error`).textContent = centerDistance(result.center, cpuCenter).toExponential(3)
  element<HTMLElement>(`#${id}-time`).textContent = `${result.elapsedMilliseconds.toFixed(2)} ms`
}

async function runTick (advance: boolean): Promise<void> {
  if (isRunning) return
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
        results.set(slot.id, result)
        showResult(slot.id, result, cpuCenter)
      } catch (error) {
        slot.error = error instanceof Error ? error.message : String(error)
        setStatus(slot.id, 'Runtime error', true)
        element<HTMLElement>(`#${slot.id}-center`).textContent = slot.error
        slot.backend.destroy()
        slot.backend = undefined
      }
    }

    const webgl = results.get('webgl')
    const webgpu = results.get('webgpu')
    deltaOutput.textContent = webgl && webgpu
      ? centerDistance(webgl.center, webgpu.center).toExponential(3)
      : 'Unavailable'
  } finally {
    isRunning = false
    stepButton.disabled = false
    resetButton.disabled = false
  }
}

function schedulePlay (): void {
  window.clearTimeout(playTimer)
  if (!isPlaying) return
  playTimer = window.setTimeout(async () => {
    await runTick(true)
    schedulePlay()
  }, 120)
}

stepButton.addEventListener('click', () => {
  runTick(true).catch(reportUnexpectedError)
})
playButton.addEventListener('click', () => {
  isPlaying = !isPlaying
  playButton.textContent = isPlaying ? 'Pause' : 'Play'
  schedulePlay()
})
resetButton.addEventListener('click', async () => {
  pointState = createPointState()
  tick = 0
  await runTick(false)
})

window.addEventListener('beforeunload', () => {
  window.clearTimeout(playTimer)
  for (const slot of slots) slot.backend?.destroy()
})

async function initialize (): Promise<void> {
  const webglCanvas = element<HTMLCanvasElement>('#webgl-canvas')
  const webgpuCanvas = element<HTMLCanvasElement>('#webgpu-canvas')

  const constructors: Array<{
    slot: BackendSlot;
    create: () => Promise<CenterMassBackend>;
  }> = [
    { slot: slots[0], create: () => createWebGLCenterMass(webglCanvas, POINT_COUNT) },
    { slot: slots[1], create: () => createWebGPUCenterMass(webgpuCanvas, POINT_COUNT) },
  ]

  await Promise.all(constructors.map(async ({ slot, create }) => {
    try {
      slot.backend = await create()
      setStatus(slot.id, 'Ready')
    } catch (error) {
      slot.error = error instanceof Error ? error.message : String(error)
      setStatus(slot.id, 'Unavailable', true)
      element<HTMLElement>(`#${slot.id}-center`).textContent = slot.error
    }
  }))

  await runTick(false)
}

initialize().catch(reportUnexpectedError)
