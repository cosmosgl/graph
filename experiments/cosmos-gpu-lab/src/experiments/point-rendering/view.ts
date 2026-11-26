import type { ExperimentInstance } from '../../runtime/experiment'
import type { PointRenderBackend } from './backend'
import { createPointData, POINT_COUNTS } from './point-data'
import { createWebGLPointRenderer } from './webgl/backend'
import { createWebGPUPointRenderer } from './webgpu/backend'

const previews = [
  { name: 'WebGL', primitive: 'Point sprites', verticesPerPoint: 1, create: createWebGLPointRenderer },
  { name: 'WebGPU', primitive: 'Instanced quads', verticesPerPoint: 6, create: createWebGPUPointRenderer },
]

type PreviewSlot = typeof previews[number] & {
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  backend?: PointRenderBackend;
}

export async function createPointRenderingExperiment (host: HTMLElement): Promise<ExperimentInstance> {
  let phase = 0
  let data = createPointData(1024, phase)
  const counts = POINT_COUNTS.map(count =>
    `<button type="button" data-count="${count}" aria-pressed="${count === data.count}">${count.toLocaleString('en-US')}</button>`
  ).join('')
  host.innerHTML = `<div class="choice-controls point-toolbar">
    <div class="choice-control" role="group" aria-labelledby="circle-count-label">
      <span id="circle-count-label" class="choice-label">Points</span>
      <div class="choice-options">${counts}</div>
    </div>
    <div class="choice-control">
      <label class="choice-label" for="circle-diameter">Diameter</label>
      <div class="range-control">
        <input id="circle-diameter" type="range" min="2" max="40" step="1" value="14">
        <output for="circle-diameter">14 buffer px</output>
      </div>
    </div>
    <button type="button" data-regenerate>Regenerate layout</button>
  </div>
  <div class="backend-panels point-render-panels">${previews.map(({ name, primitive }) =>
    `<section class="backend-panel"><strong>${name} · ${primitive}</strong>
      <canvas width="480" height="340" aria-label="${name} circle preview"></canvas>
      <p class="case-meta" role="status" aria-label="${name} preview status">Starting…</p></section>`
  ).join('')}</div>`

  const diameter = host.querySelector<HTMLInputElement>('#circle-diameter')!
  const diameterOutput = host.querySelector<HTMLOutputElement>('output')!
  const buttons = host.querySelectorAll<HTMLButtonElement>('button[data-count]')
  const panels = host.querySelectorAll<HTMLElement>('.backend-panel')
  const slots: PreviewSlot[] = previews.map((preview, index) => ({
    ...preview,
    canvas: panels[index].querySelector('canvas')!,
    status: panels[index].querySelector<HTMLElement>('[role="status"]')!,
  }))

  function release (slot: PreviewSlot): void {
    const backend = slot.backend
    slot.backend = undefined
    try { backend?.destroy() } catch (error) { console.warn(`Could not release the ${slot.name} preview`, error) }
  }

  function unavailable (slot: PreviewSlot, error: unknown): void {
    release(slot)
    slot.canvas.hidden = true
    slot.status.className = 'canvas-error'
    slot.status.textContent = error instanceof Error ? error.message : String(error)
  }

  function draw (slot: PreviewSlot, upload: boolean): void {
    if (!slot.backend) return
    try {
      if (upload) slot.backend.setData(data)
      slot.backend.render(Number(diameter.value))
      if (upload) {
        const vertices = data.count * slot.verticesPerPoint
        slot.status.textContent = `${vertices.toLocaleString('en-US')} ${vertices === 1 ? 'vertex' : 'vertices'} in one draw call`
      }
    } catch (error) {
      unavailable(slot, error)
    }
  }

  const updatePoints = (count: number): void => {
    data = createPointData(count, phase)
    for (const button of buttons) button.setAttribute('aria-pressed', String(Number(button.dataset.count) === count))
    for (const slot of slots) draw(slot, true)
  }
  for (const button of buttons) button.onclick = (): void => updatePoints(Number(button.dataset.count))
  diameter.oninput = (): void => {
    diameterOutput.value = `${diameter.value} buffer px`
    for (const slot of slots) draw(slot, false)
  }
  host.querySelector<HTMLButtonElement>('[data-regenerate]')!.onclick = (): void => {
    phase++
    updatePoints(data.count)
  }

  await Promise.all(slots.map(async slot => {
    try {
      slot.backend = await slot.create(slot.canvas)
    } catch (error) {
      unavailable(slot, error)
      return
    }
    draw(slot, true)
  }))

  return {
    destroy (): void {
      for (const slot of slots) release(slot)
      host.replaceChildren()
    },
  }
}
