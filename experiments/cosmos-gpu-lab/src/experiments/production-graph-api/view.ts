import type { ExperimentInstance } from '../../runtime/experiment'
import type { Engine, PublicGraphSession } from './frame'

type Lane = { engine: Engine; panel: HTMLElement; output: HTMLElement; frame?: HTMLIFrameElement; session?: PublicGraphSession }

export function createPackageView (host: HTMLElement): ExperimentInstance {
  host.innerHTML = `<div class="controls"><button type="button" data-step disabled>Step gravity</button>
    <button type="button" data-reset>Reset</button></div>
    <div class="viewer-comparison-panels"></div>`
  const panels = host.querySelector<HTMLElement>('.viewer-comparison-panels')!
  const step = host.querySelector<HTMLButtonElement>('[data-step]')!
  const reset = host.querySelector<HTMLButtonElement>('[data-reset]')!
  let busy = false
  let dead = false
  const lanes = (['webgl', 'webgpu'] as const).map((engine): Lane => {
    const panel = document.createElement('section')
    const heading = document.createElement('h3')
    heading.textContent = engine === 'webgl' ? 'WebGL Graph' : 'WebGPU Graph'
    const output = document.createElement('p')
    output.setAttribute('role', 'status')
    panel.append(heading, output); panels.append(panel)
    return { engine, panel, output }
  })
  const controls = (): void => { step.disabled = busy || !lanes.some(lane => lane.session); reset.disabled = busy }
  const show = (lane: Lane, xy: Float32Array): void => {
    if (xy.length !== 6 || !Number.isNaN(xy[4]) || !Number.isNaN(xy[5])) throw new Error('Unexpected point count or absent position')
    lane.output.textContent = `Pinned x ${xy[0].toFixed(1)} · Free x ${xy[2].toFixed(1)}`
  }
  const load = (lane: Lane): void => {
    lane.session?.destroy()
    lane.session = undefined
    lane.frame?.remove()
    lane.output.textContent = 'Loading package…'
    const frame = document.createElement('iframe')
    lane.frame = frame
    frame.title = lane.engine === 'webgl' ? 'WebGL Graph' : 'WebGPU Graph'
    frame.style.cssText = 'display:block;border:0;width:100%;height:240px'
    frame.onload = async (): Promise<void> => {
      let session: PublicGraphSession | undefined
      try {
        const application = (frame.contentWindow as Window & { publicGraph?: Promise<PublicGraphSession> }).publicGraph
        if (!application) throw new Error('Graph frame did not initialize')
        session = await application
        const xy = await session.positions()
        if (dead || lane.frame !== frame) { session.destroy(); return }
        show(lane, xy); lane.session = session
      } catch (error) {
        session?.destroy()
        if (!dead && lane.frame === frame) lane.output.textContent = String(error)
      } finally { if (!dead) controls() }
    }
    frame.src = new URL(`production-viewer.html?view=public-graph&engine=${lane.engine}`, document.baseURI).href
    lane.panel.insertBefore(frame, lane.output)
  }
  reset.onclick = (): void => { lanes.forEach(load); controls() }
  step.onclick = async (): Promise<void> => {
    busy = true; controls()
    try {
      await Promise.all(lanes.map(async lane => {
        if (!lane.session) return
        try { const xy = await lane.session.step(); if (!dead) show(lane, xy) } catch (error) {
          lane.session?.destroy(); lane.session = undefined
          if (!dead) lane.output.textContent = String(error)
        }
      }))
    } finally { if (!dead) { busy = false; controls() } }
  }
  lanes.forEach(load)
  return {
    destroy (): void {
      dead = true
      for (const lane of lanes) { lane.session?.destroy(); lane.frame?.remove() }
    },
  }
}
