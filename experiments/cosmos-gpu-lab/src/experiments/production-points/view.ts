import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { comparePoints } from './compare'
import { defaultDiameter, fractionalDiameters, pointCases, pointShapes, pointsViewport } from './fixture'
import type { PointsSession } from './frame'
import './view.css'

type Lane = {
  engine: 'webgl' | 'webgpu';
  surface: HTMLElement;
  status: HTMLElement;
  frame?: HTMLIFrameElement;
  session?: PointsSession;
  snapshot?: ImageData;
}

export function createPointsView (host: HTMLElement, caseId?: string): ExperimentInstance {
  const ratio = caseId === 'dpr-2' ? 2 : 1
  const compactHeadings = ['Aligned', 'Size', 'Position', 'Both']
  host.innerHTML = `<div class="scale-toolbar" data-run-part="configuration">
      <label>Fractional diameter (CSS px)
        <select data-points-diameter>${fractionalDiameters.map(value => `<option value="${value}">${value}</option>`).join('')}</select>
      </label>
    </div>
    <button type="button" data-run-action="primary" data-points-reload>Reload</button>
    <div class="points-comparison" data-run-part="visualization">
      <div class="points-comparison-panels"></div>
      <p class="points-grid-key">The previews show shapes left to right and input cases top to bottom, in table order.</p>
      <label class="points-difference-control"><input type="checkbox" data-points-highlight disabled>
        Highlight differing pixels in magenta on WebGPU</label>
    </div>
    <p class="points-comparison-verdict" data-run-part="status" data-points-result></p>
    <div class="points-comparison-table" data-run-part="status">
      <table><caption>Differing device pixels by shape and fractional input</caption>
        <thead><tr><th scope="col">Shape</th>${pointCases.map((label, i) => `<th scope="col" aria-label="${label}">
          <span class="points-heading-full">${label}</span><span class="points-heading-compact">${compactHeadings[i]}</span></th>`).join('')}</tr></thead>
        <tbody data-points-counts>${pointShapes.map(shape =>
    `<tr><th scope="row">${shape}</th>${pointCases.map(() => '<td>—</td>').join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`
  mountRunLayout(host)
  const panels = host.querySelector<HTMLElement>('.points-comparison-panels')!
  panels.style.setProperty('--points-width', `${pointsViewport.width}px`)
  panels.style.setProperty('--points-height', `${pointsViewport.height}px`)
  const reload = host.querySelector<HTMLButtonElement>('[data-points-reload]')!
  const diameter = host.querySelector<HTMLSelectElement>('[data-points-diameter]')!
  diameter.value = String(defaultDiameter)
  const highlight = host.querySelector<HTMLInputElement>('[data-points-highlight]')!
  const verdict = host.querySelector<HTMLElement>('[data-points-result]')!
  const table = host.querySelector<HTMLTableSectionElement>('[data-points-counts]')!
  const lanes = (['webgl', 'webgpu'] as const).map((engine): Lane => {
    const panel = document.createElement('section')
    const heading = document.createElement('h3')
    heading.textContent = engine === 'webgl' ? 'WebGL Graph' : 'WebGPU Graph'
    const surface = document.createElement('div')
    surface.className = 'points-comparison-surface'
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    panel.append(heading, surface, status)
    panels.append(panel)
    return { engine, surface, status }
  })
  const overlay = document.createElement('canvas')
  overlay.width = pointsViewport.width * ratio
  overlay.height = pointsViewport.height * ratio
  overlay.hidden = true
  overlay.setAttribute('aria-hidden', 'true')
  lanes[1].surface.append(overlay)
  const context = overlay.getContext('2d')
  const lifetime = new AbortController()
  let pending: Promise<void>

  function release (lane: Lane): void {
    lane.session?.destroy()
    lane.frame?.remove()
    lane.frame = lane.session = lane.snapshot = undefined
  }

  async function load (lane: Lane): Promise<void> {
    release(lane)
    lane.status.textContent = 'Loading package…'
    const frame = document.createElement('iframe')
    lane.frame = frame
    frame.title = `Point shapes rendered by the ${lane.engine === 'webgl' ? 'WebGL' : 'WebGPU'} Graph`
    frame.width = String(pointsViewport.width)
    frame.height = String(pointsViewport.height)
    frame.tabIndex = -1
    frame.inert = true
    frame.src = new URL(`production-viewer.html?view=points&engine=${lane.engine}&ratio=${ratio}&diameter=${diameter.value}`, document.baseURI).href
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => reject(new Error('Point preview closed'))
        lifetime.signal.addEventListener('abort', abort, { once: true })
        frame.onload = (): void => { lifetime.signal.removeEventListener('abort', abort); resolve() }
        frame.onerror = (): void => { lifetime.signal.removeEventListener('abort', abort); reject(new Error('Could not load the point preview')) }
        lane.surface.append(frame)
      })
      const application = (frame.contentWindow as Window & { pointsComparison?: Promise<PointsSession> }).pointsComparison
      if (!application) throw new Error('The Graph frame did not initialize')
      lane.session = await application
      if (lifetime.signal.aborted) return
      lane.snapshot = await lane.session.snapshot()
      lane.status.textContent = ''
    } catch (error) {
      release(lane)
      if (!lifetime.signal.aborted) lane.status.textContent = String(error)
    }
  }

  function show (): void {
    if (lifetime.signal.aborted) return
    const [gl, gpu] = lanes.map(lane => lane.snapshot)
    reload.disabled = diameter.disabled = false
    if (!gl || !gpu) {
      verdict.textContent = 'Comparison requires both graph snapshots.'
      return
    }
    try {
      const mask = context?.createImageData(overlay.width, overlay.height)
      const result = comparePoints(gl, gpu, ratio, mask)
      const total = result.totalPixels.toLocaleString()
      const count = result.differingPixels.toLocaleString()
      const coverage = result.differingPixels === 0 ? `Exact match across ${total} device pixels.` : `${count} of ${total} device pixels differ.`
      verdict.textContent = `${coverage} Largest RGBA channel difference is ${result.maxChannelDelta} of 255.`
      result.byShape.forEach((counts, i) => counts.forEach((count, j) => {
        table.rows[i].cells[j + 1].textContent = count.toLocaleString()
      }))
      if (mask && context) {
        context.putImageData(mask, 0, 0)
        highlight.disabled = false
        overlay.hidden = !highlight.checked
      }
    } catch (error) { verdict.textContent = String(error) }
  }

  function run (both: boolean): void {
    if (reload.disabled || lifetime.signal.aborted) return
    reload.disabled = diameter.disabled = highlight.disabled = overlay.hidden = true
    verdict.textContent = 'Comparing both canvases…'
    for (const cell of table.querySelectorAll('td')) cell.textContent = '—'
    // When one backend failed, keep the successful capture visible while retrying the other.
    const unavailable = lanes.filter(lane => !lane.snapshot)
    pending = Promise.all((!both && unavailable.length ? unavailable : lanes).map(load)).then(show)
  }

  reload.onclick = (): void => run(false)
  diameter.onchange = (): void => run(true)
  highlight.onchange = (): void => { overlay.hidden = !highlight.checked }
  run(true)
  return {
    destroy (): void {
      lifetime.abort()
      pending.then(() => lanes.forEach(release))
      disposeRunLayout(host)
    },
  }
}
