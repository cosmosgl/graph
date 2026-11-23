import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { comparePoints } from './compare'
import { defaultDiameter, fractionalDiameters, pointCases, pointPlacements, pointShapes, pointsViewport, tieControlDiameter } from './fixture'
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
  const placementLabels = {
    standard: '(0.25, 0.375) CSS px',
    offgrid: '(0.1, 0.4) CSS px',
    ties: '1/32-device-pixel rounding ties',
  }
  host.innerHTML = `<div class="scale-toolbar" data-run-part="configuration">
      <label>Center offset
        <select data-points-placement>${pointPlacements.map(id => `<option value="${id}">${placementLabels[id]}</option>`).join('')}</select>
      </label>
      <label>Diameter (CSS px)
        <select data-points-diameter>${fractionalDiameters.map(value => `<option value="${value}">${value}</option>`).join('')}
          <option value="${tieControlDiameter}" hidden disabled>24 / 22 control</option></select>
      </label>
    </div>
    <button type="button" data-run-action="primary" data-points-reload>Reload</button>
    <div class="points-comparison" data-run-part="visualization">
      <div class="points-comparison-panels"></div>
      <p class="points-grid-key"></p>
      <label class="points-difference-control"><input type="checkbox" data-points-highlight disabled>
        Highlight differing pixels in magenta on WebGPU</label>
    </div>
    <p class="points-comparison-verdict" data-run-part="status" data-points-result></p>
    <div class="points-comparison-table" data-run-part="status">
      <table><caption>Differing device pixels by shape and row</caption>
        <thead><tr><th scope="col">Shape</th>${pointCases.map(() => '<th scope="col"></th>').join('')}</tr></thead>
        <tbody data-points-counts>${pointShapes.map(shape =>
    `<tr><th scope="row">${shape}</th>${pointCases.map(() => '<td>—</td>').join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`
  mountRunLayout(host)
  const panels = host.querySelector<HTMLElement>('.points-comparison-panels')!
  panels.style.setProperty('--points-width', `${pointsViewport.width}px`)
  panels.style.setProperty('--points-height', `${pointsViewport.height}px`)
  const reload = host.querySelector<HTMLButtonElement>('[data-points-reload]')!
  const placement = host.querySelector<HTMLSelectElement>('[data-points-placement]')!
  const diameter = host.querySelector<HTMLSelectElement>('[data-points-diameter]')!
  const tieControl = diameter.querySelector<HTMLOptionElement>(`option[value="${tieControlDiameter}"]`)!
  const gridKey = host.querySelector<HTMLElement>('.points-grid-key')!
  const columnHeadings = host.querySelectorAll<HTMLTableCellElement>('.points-comparison-table thead th:not(:first-child)')
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
    const url = new URL('production-viewer.html', document.baseURI)
    url.search = new URLSearchParams({ view: 'points', engine: lane.engine, ratio: String(ratio), diameter: diameter.value, placement: placement.value }).toString()
    frame.src = url.href
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
    reload.disabled = diameter.disabled = placement.disabled = false
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
    reload.disabled = diameter.disabled = placement.disabled = highlight.disabled = overlay.hidden = true
    verdict.textContent = 'Comparing both canvases…'
    for (const cell of table.querySelectorAll('td')) cell.textContent = '—'
    // When one backend failed, keep the successful capture visible while retrying the other.
    const unavailable = lanes.filter(lane => !lane.snapshot)
    pending = Promise.all((!both && unavailable.length ? unavailable : lanes).map(load)).then(show)
  }

  function setPlacement (): void {
    const ties = placement.value === 'ties'
    if (!ties && diameter.value === String(tieControlDiameter)) diameter.value = String(defaultDiameter)
    tieControl.hidden = tieControl.disabled = !ties
    columnHeadings.forEach((heading, i) => {
      const full = ties ? `Tie row ${i + 1}` : pointCases[i]!
      const compact = ties ? `Row ${i + 1}` : compactHeadings[i]!
      heading.setAttribute('aria-label', full)
      heading.innerHTML = `<span class="points-heading-full">${full}</span><span class="points-heading-compact">${compact}</span>`
    })
    gridKey.textContent = ties
      ? 'Each center falls halfway between two 1/16-device-pixel grid lines on both axes. Each table column reports one preview row.'
      : 'The upper two rows use integer centers. The lower two apply the selected offset right and down. Rows alternate between 22 px and the selected diameter.'
    run(true)
  }

  reload.onclick = (): void => run(false)
  diameter.onchange = (): void => run(true)
  placement.onchange = setPlacement
  highlight.onchange = (): void => { overlay.hidden = !highlight.checked }
  setPlacement()
  return {
    destroy (): void {
      lifetime.abort()
      pending.then(() => lanes.forEach(release))
      disposeRunLayout(host)
    },
  }
}
