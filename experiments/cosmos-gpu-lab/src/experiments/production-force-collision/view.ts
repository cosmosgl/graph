import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { compareCollision } from './compare'
import { collisionViewport } from './fixture'
import type { CollisionSession, CollisionSnapshot } from './frame'
import './view.css'

type Lane = {
  engine: 'webgl' | 'webgpu';
  surface: HTMLElement;
  status: HTMLElement;
  frame?: HTMLIFrameElement;
  session?: CollisionSession;
  snapshot?: CollisionSnapshot;
  pending?: Promise<void>;
}

export function createCollisionView (host: HTMLElement, caseId?: string): ExperimentInstance {
  const fixture = caseId === 'hashed' ? 'hashed' : 'contacts'
  host.innerHTML = `<button type="button" data-run-action="primary" data-step>Step collision</button>
    <button type="button" data-run-action="primary" data-reset>Reset</button>
    <div class="collision-graph-panels" data-run-part="visualization"></div>
    <div class="collision-graph-results" data-run-part="status">
      <dl><div><dt>Point positions</dt><dd data-positions></dd></div>
      <div><dt>Rendered pixels</dt><dd data-pixels></dd></div></dl>
      <label class="collision-highlight"><input type="checkbox" disabled>
        Highlight differing pixels in magenta on WebGPU</label>
    </div>`
  mountRunLayout(host)
  const panels = host.querySelector<HTMLElement>('.collision-graph-panels')!
  const step = host.querySelector<HTMLButtonElement>('[data-step]')!
  const reset = host.querySelector<HTMLButtonElement>('[data-reset]')!
  const positions = host.querySelector<HTMLElement>('[data-positions]')!
  const pixels = host.querySelector<HTMLElement>('[data-pixels]')!
  const highlight = host.querySelector<HTMLInputElement>('.collision-highlight input')!
  const lanes = (['webgl', 'webgpu'] as const).map((engine): Lane => {
    const panel = document.createElement('section')
    const heading = document.createElement('h3')
    heading.textContent = engine === 'webgl' ? 'WebGL Graph' : 'WebGPU Graph'
    const surface = document.createElement('div')
    surface.className = 'collision-graph-surface'
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    panel.append(heading, surface, status)
    panels.append(panel)
    return { engine, surface, status }
  })
  const overlay = document.createElement('canvas')
  overlay.width = collisionViewport.width
  overlay.height = collisionViewport.height
  overlay.hidden = true
  overlay.setAttribute('aria-hidden', 'true')
  lanes[1].surface.append(overlay)
  const overlayContext = overlay.getContext('2d')
  const lifetime = new AbortController()
  let busy = false

  function release (lane: Lane): void {
    lane.session?.destroy()
    lane.session = undefined
    lane.snapshot = undefined
    lane.frame?.remove()
    lane.frame = undefined
  }

  async function load (lane: Lane): Promise<void> {
    release(lane)
    lane.status.textContent = 'Loading package…'
    const frame = document.createElement('iframe')
    frame.title = `ForceCollision in the ${lane.engine === 'webgl' ? 'WebGL' : 'WebGPU'} Graph`
    frame.width = String(collisionViewport.width)
    frame.height = String(collisionViewport.height)
    frame.tabIndex = -1
    frame.inert = true
    lane.frame = frame
    frame.src = new URL(`production-viewer.html?view=force-collision&engine=${lane.engine}&fixture=${fixture}`, document.baseURI).href
    // Navigating away can remove the frame before its load event fires.
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => reject(new Error('Graph frame closed'))
      const finish = (error?: Error): void => {
        lifetime.signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve()
      }
      frame.onload = (): void => finish()
      frame.onerror = (): void => finish(new Error('Could not load graph frame'))
      lifetime.signal.addEventListener('abort', abort, { once: true })
      lane.surface.append(frame)
    })
    const application = (frame.contentWindow as Window & { forceCollision?: Promise<CollisionSession> }).forceCollision
    if (!application) throw new Error('Graph frame did not initialize')
    lane.session = await application
    if (!lifetime.signal.aborted) lane.snapshot = await lane.session.snapshot()
  }

  function showResults (): void {
    const [gl, gpu] = lanes.map(lane => lane.snapshot)
    overlay.hidden = true
    highlight.disabled = true
    if (gl && gpu) {
      try {
        const mask = highlight.checked ? overlayContext?.createImageData(overlay.width, overlay.height) : undefined
        const result = compareCollision(gl, gpu, mask)
        const count = gl.positions.length / 2
        const positionCounts = `${result.positionMismatches.toLocaleString()} of ${count.toLocaleString()} point slots differ.`
        const pixelCounts = `${result.differingPixels.toLocaleString()} of ${result.totalPixels.toLocaleString()} pixels differ.`
        positions.textContent = result.positionMismatches === 0
          ? `Exact match across ${count.toLocaleString()} point slots.`
          : `${positionCounts} Largest coordinate difference is ${Number(result.maxPositionDelta.toPrecision(6))} graph units.`
        pixels.textContent = result.differingPixels === 0
          ? `Exact match across ${result.totalPixels.toLocaleString()} pixels.`
          : `${pixelCounts} Largest RGBA channel difference is ${result.maxChannelDelta} of 255.`
        highlight.disabled = !overlayContext
        if (mask && overlayContext) {
          overlayContext.putImageData(mask, 0, 0)
          overlay.hidden = false
        }
      } catch (error) {
        positions.textContent = pixels.textContent = String(error)
      }
    } else {
      positions.textContent = pixels.textContent = 'Comparison requires both graph snapshots.'
    }
  }

  async function run (resetGraphs: boolean): Promise<void> {
    if (busy || lifetime.signal.aborted) return
    busy = step.disabled = reset.disabled = true
    highlight.disabled = overlay.hidden = true
    overlayContext?.clearRect(0, 0, overlay.width, overlay.height)
    positions.textContent = pixels.textContent = resetGraphs ? 'Waiting for both graphs…' : 'Checking the next tick…'
    await Promise.all(lanes.map(lane => {
      lane.pending = (async (): Promise<void> => {
        try {
          if (resetGraphs) await load(lane)
          else if (lane.session) lane.snapshot = await lane.session.step()
          if (!lifetime.signal.aborted && lane.snapshot) lane.status.textContent = `Paused at tick ${lane.snapshot.tick}.`
        } catch (error) {
          release(lane)
          if (!lifetime.signal.aborted) lane.status.textContent = String(error)
        }
      })()
      return lane.pending
    }))
    if (lifetime.signal.aborted) return
    busy = reset.disabled = false
    step.disabled = !lanes.some(lane => lane.session)
    showResults()
  }

  reset.onclick = (): Promise<void> => run(true)
  step.onclick = (): Promise<void> => run(false)
  highlight.onchange = showResults
  run(true)
  return {
    destroy (): void {
      lifetime.abort()
      lanes.forEach(lane => lane.pending?.then(() => release(lane)))
      disposeRunLayout(host)
    },
  }
}
