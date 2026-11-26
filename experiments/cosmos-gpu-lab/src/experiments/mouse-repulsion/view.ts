import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { createBackend, type Api, type MouseBackend } from './backend'
import { DEFAULT_STRENGTH, movingFixture, screenToWorld, viewFor, type Camera, type Vector, type Viewport } from './data'
import { compareMouse, mouseReference } from './reference'

export async function createView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar">
      <label>Pointer strength <input data-strength type="number" step="any" required value="${DEFAULT_STRENGTH}"></label>
      <label>View <select data-camera><option value="center">Centered</option><option value="pan">Panned and zoomed</option></select></label>
    </div>
    <button data-run-action="primary" data-step disabled>Step and check</button>
    <button data-run-action="primary" data-reset disabled>Reset</button>
    <p role="status" data-run-part="status">Preparing the pointer-force comparison…</p>
    <section data-run-part="visualization" class="backend-panels">
      <article class="backend-panel"><h2>Production WebGL</h2>
        <canvas width="480" height="340" data-webgl aria-label="Production WebGL mouse repulsion"></canvas></article>
      <article class="backend-panel"><h2>WebGPU</h2>
        <canvas width="480" height="340" data-webgpu aria-label="WebGPU mouse repulsion"></canvas></article>
    </section>
    <p data-run-part="explanation">Move over either canvas holding the right button. The pointer pushes points while the main simulation is paused.
      Step and check applies one push at the last pointer position and compares with the CPU. Squares mark pinned points.</p>
    <p data-run-part="results" data-check></p>`
  const element = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const status = element('[role="status"]')
  const output = element('[data-check]')
  const step = element<HTMLButtonElement>('[data-step]')
  const reset = element<HTMLButtonElement>('[data-reset]')
  const strengthInput = element<HTMLInputElement>('[data-strength]')
  const viewChoice = element<HTMLSelectElement>('[data-camera]')
  const input = movingFixture(256, [0, 0])
  const lanes: Array<{ api: Api; canvas: HTMLCanvasElement; backend: MouseBackend }> = []
  const listeners = new AbortController()
  let frame = 0
  let ticks = 0
  let ready = false
  let destroyed = false
  let checking = false
  let secondaryHeld = false
  let world: Vector = [0, 0]
  let passed = 0
  let failed = 0
  let error = ''

  const stop = (): void => {
    secondaryHeld = false
    cancelAnimationFrame(frame)
    frame = 0
  }
  const fail = (cause: unknown): void => {
    stop()
    error = String(cause)
    status.textContent = error
  }
  const viewport = (canvas: HTMLCanvasElement): Viewport => ({
    width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height,
  })
  const camera = ({ width, height }: Viewport): Camera => {
    const panned = viewChoice.value === 'pan'
    const zoom = Math.min(width, height) / (panned ? 124 : 144)
    return {
      origin: [0, 0],
      zoom,
      translation: [width / 2 * (1 - zoom) + (panned ? width * 0.1 : 0), height / 2 * (1 - zoom) - (panned ? height * 0.07 : 0)],
    }
  }
  const showPosition = (): void => {
    status.textContent = `Main simulation paused · ${ticks} pointer steps · world (${world[0].toFixed(1)}, ${world[1].toFixed(1)})`
  }
  const draw = (): void => {
    for (const lane of lanes) {
      const size = viewport(lane.canvas)
      lane.backend.render(viewFor(size, camera(size)))
    }
    showPosition()
  }
  const encode = (strength: number): void => {
    for (const lane of lanes) {
      lane.backend.setPointer(world, strength)
      lane.backend.stepWhenHeld({ simulationEnabled: true, rightClickRepulsionEnabled: true, secondaryHeld: true })
    }
    ticks++
  }
  const animate = (): void => {
    frame = 0
    if (!secondaryHeld || checking || destroyed || !ready || !strengthInput.validity.valid) return
    try {
      encode(strengthInput.valueAsNumber)
      draw()
      frame = requestAnimationFrame(animate)
    } catch (cause) { fail(cause) }
  }
  const onPointer = (event: PointerEvent): void => {
    if (!event.isPrimary || checking || !ready) return
    const size = viewport(event.currentTarget as HTMLCanvasElement)
    world = screenToWorld([event.offsetX, event.offsetY], size, camera(size))
    secondaryHeld = (event.buttons & 2) !== 0
    if (secondaryHeld && !frame) frame = requestAnimationFrame(animate)
    if (!secondaryHeld && !error) {
      stop()
      showPosition()
    }
  }
  const stepAndCheck = async (): Promise<void> => {
    stop()
    if (!strengthInput.reportValidity()) return
    checking = true
    step.disabled = true
    reset.disabled = true
    try {
      const strength = strengthInput.valueAsNumber
      const before = await Promise.all(lanes.map(lane => lane.backend.read()))
      if (destroyed) return
      encode(strength)
      const after = await Promise.all(lanes.map(lane => lane.backend.read()))
      if (destroyed) return
      passed = 0
      failed = 0
      output.textContent = lanes.map(({ api }, i) => {
        const expected = mouseReference(before[i].positions, world, strength)
        const check = compareMouse(after[i], expected, before[i].positions, world, api === 'webgl')
        if (check.valid) passed++
        else failed++
        const label = api === 'webgl' ? 'WebGL' : 'WebGPU'
        return `${label} ${check.valid ? 'passed' : 'failed'} · max force error ${check.forces.maxError.toExponential(2)} · max position error ` +
          `${check.positions.maxError.toExponential(2)}${check.coincident ? ` · ${check.coincident} coincident point omitted from legacy comparison` : ''}`
      }).join('\n')
      draw()
    } catch (cause) { if (!destroyed) fail(cause) } finally {
      checking = false
      if (!destroyed) { step.disabled = false; reset.disabled = false }
    }
  }
  step.addEventListener('click', () => { stepAndCheck().catch(fail) }, { signal: listeners.signal })
  reset.addEventListener('click', () => {
    stop()
    ticks = 0
    passed = 0
    failed = 0
    error = ''
    output.textContent = ''
    try { for (const lane of lanes) lane.backend.setPositions(input.points); draw() } catch (cause) { fail(cause) }
  }, { signal: listeners.signal })
  viewChoice.addEventListener('change', () => {
    stop()
    if (ready && !checking) try { draw() } catch (cause) { fail(cause) }
  }, { signal: listeners.signal })
  mountRunLayout(host, () => ({
    state: error ? 'Failed' : checking ? 'Checking' : ready ? 'Main simulation paused' : 'Preparing',
    passed: passed ? `${passed} current backend checks` : 'None recorded',
    failed: error || (failed ? `${failed} current backend checks` : 'None recorded'),
    unchecked: 'Production force composition and frame responsiveness.',
  }), { experiment: 'mouse-repulsion', devices: () => lanes.map(lane => lane.backend.info) })
  try {
    for (const api of ['webgl', 'webgpu'] as const) {
      const canvas = element<HTMLCanvasElement>(`[data-${api}]`)
      const backend = await createBackend(api, canvas, input)
      lanes.push({ api, canvas, backend })
      for (const type of ['pointermove', 'pointerup'] as const) canvas.addEventListener(type, onPointer, { signal: listeners.signal })
      for (const type of ['pointercancel', 'pointerleave'] as const) {
        canvas.addEventListener(type, event => { if (event.isPrimary) stop() }, { signal: listeners.signal })
      }
      canvas.addEventListener('contextmenu', event => event.preventDefault(), { signal: listeners.signal })
    }
    ready = true
    step.disabled = false
    reset.disabled = false
    draw()
  } catch (cause) { fail(cause) }
  return {
    pause: stop,
    destroy (): void {
      destroyed = true
      stop()
      listeners.abort()
      disposeRunLayout(host)
      for (const lane of lanes) lane.backend.destroy()
    },
  }
}
