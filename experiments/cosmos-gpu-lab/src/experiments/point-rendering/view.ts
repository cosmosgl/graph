import type { ExperimentInstance } from '../../runtime/experiment'
import type { PointRenderBackend, PointRenderData } from './backend'
import { createPointData, POINT_COUNTS } from './point-data'
import { createWebGLPointRenderer } from './webgl/backend'
import { createWebGPUPointRenderer } from './webgpu/backend'

type BackendSlot = {
  id: 'webgl' | 'webgpu';
  backend?: PointRenderBackend;
}

function element<T extends HTMLElement> (host: ParentNode, selector: string): T {
  const found = host.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

function setStatus (
  host: HTMLElement,
  slot: BackendSlot,
  message: string,
  failed = false
): void {
  const status = element<HTMLElement>(host, `[data-status="${slot.id}"]`)
  status.textContent = message
  status.classList.toggle('failed', failed)
}

function showBackendError (host: HTMLElement, slot: BackendSlot, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  setStatus(host, slot, 'Unavailable', true)
  const canvas = element<HTMLCanvasElement>(host, `[data-canvas="${slot.id}"]`)
  canvas.insertAdjacentHTML('afterend', '<p class="canvas-error"></p>')
  const errorOutput = canvas.nextElementSibling
  if (errorOutput) errorOutput.textContent = message
}

export async function createPointRenderingExperiment (
  host: HTMLElement
): Promise<ExperimentInstance> {
  const countOptions = POINT_COUNTS.map(count =>
    `<option value="${count}" ${count === 1024 ? 'selected' : ''}>${count.toLocaleString()}</option>`
  ).join('')

  host.innerHTML = `
    <section class="point-rendering-demo">
      <div class="scale-toolbar point-toolbar">
        <label>
          Points
          <select data-control="count">${countOptions}</select>
        </label>
        <label class="range-control">
          Diameter <output data-output="diameter">14 px</output>
          <input data-control="diameter" type="range" min="2" max="40" step="1" value="14">
        </label>
        <div class="controls">
          <button data-action="regenerate" type="button">Regenerate layout</button>
        </div>
      </div>

      <section class="summary" aria-live="polite">
        <span>Shared input <strong data-output="count">1,024 points</strong></span>
        <span>Position + color data <strong data-output="bytes">24 KiB</strong></span>
        <span>Draw calls <strong>1 per backend</strong></span>
      </section>

      <section class="backend-panels point-render-panels">
        <article class="backend-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Cosmos/WebGL approach</p>
              <h2>Point sprite</h2>
            </div>
            <span data-status="webgl" class="status">Starting…</span>
          </div>
          <canvas data-canvas="webgl" width="480" height="340"></canvas>
          <dl>
            <div><dt>Primitive</dt><dd>point-list</dd></div>
            <div><dt>Submitted</dt><dd data-output="webgl-vertices">1,024 vertices</dd></div>
            <div><dt>Circle coordinates</dt><dd>gl_PointCoord</dd></div>
          </dl>
        </article>

        <article class="backend-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">WebGPU approach</p>
              <h2>Instanced quad</h2>
            </div>
            <span data-status="webgpu" class="status">Starting…</span>
          </div>
          <canvas data-canvas="webgpu" width="480" height="340"></canvas>
          <dl>
            <div><dt>Primitive</dt><dd>triangle-list</dd></div>
            <div><dt>Submitted</dt><dd data-output="webgpu-vertices">6,144 vertices (6 × 1,024)</dd></div>
            <div><dt>Circle coordinates</dt><dd>vertex varying</dd></div>
          </dl>
        </article>
      </section>

      <p class="demo-note">
        Both canvases receive identical positions, colors and CSS-pixel diameter. The WebGL
        shader uses the point-sprite path used by Cosmos today; WebGPU expands each instance
        into two triangles because portable wide points are not available.
      </p>
    </section>
  `

  const countSelect = element<HTMLSelectElement>(host, '[data-control="count"]')
  const diameterInput = element<HTMLInputElement>(host, '[data-control="diameter"]')
  const regenerateButton = element<HTMLButtonElement>(host, '[data-action="regenerate"]')
  const slots: BackendSlot[] = [{ id: 'webgl' }, { id: 'webgpu' }]
  let data: PointRenderData = createPointData(1024, 0)
  let phase = 0
  let destroyed = false

  const updateMetrics = (): void => {
    const bytes = data.positions.byteLength + data.colors.byteLength
    const pointNoun = data.count === 1 ? 'point' : 'points'
    const vertexNoun = data.count === 1 ? 'vertex' : 'vertices'
    element<HTMLElement>(host, '[data-output="count"]').textContent =
      `${data.count.toLocaleString()} ${pointNoun}`
    element<HTMLElement>(host, '[data-output="bytes"]').textContent =
      `${(bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`
    element<HTMLElement>(host, '[data-output="webgl-vertices"]').textContent =
      `${data.count.toLocaleString()} ${vertexNoun}`
    element<HTMLElement>(host, '[data-output="webgpu-vertices"]').textContent =
      `${(data.count * 6).toLocaleString()} vertices (6 × ${data.count.toLocaleString()})`
  }

  const render = (): void => {
    const diameter = Number(diameterInput.value)
    element<HTMLOutputElement>(host, '[data-output="diameter"]').value = `${diameter} px`
    for (const slot of slots) {
      if (!slot.backend) continue
      try {
        slot.backend.render(diameter)
      } catch (error) {
        slot.backend.destroy()
        slot.backend = undefined
        showBackendError(host, slot, error)
      }
    }
  }

  const setData = (): void => {
    updateMetrics()
    for (const slot of slots) slot.backend?.setData(data)
    render()
  }

  countSelect.addEventListener('change', () => {
    data = createPointData(Number(countSelect.value), phase)
    setData()
  })
  diameterInput.addEventListener('input', render)
  regenerateButton.addEventListener('click', () => {
    phase += 1
    data = createPointData(data.count, phase)
    setData()
  })

  const constructors: Array<{
    slot: BackendSlot;
    create: () => Promise<PointRenderBackend>;
  }> = [
    {
      slot: slots[0],
      create: () => createWebGLPointRenderer(element(host, '[data-canvas="webgl"]')),
    },
    {
      slot: slots[1],
      create: () => createWebGPUPointRenderer(element(host, '[data-canvas="webgpu"]')),
    },
  ]

  await Promise.all(constructors.map(async ({ slot, create }) => {
    try {
      slot.backend = await create()
      slot.backend.setData(data)
      slot.backend.render(Number(diameterInput.value))
      setStatus(host, slot, 'Ready')
    } catch (error) {
      showBackendError(host, slot, error)
    }
  }))
  updateMetrics()

  return {
    destroy (): void {
      if (destroyed) return
      destroyed = true
      for (const slot of slots) slot.backend?.destroy()
      host.replaceChildren()
    },
  }
}
