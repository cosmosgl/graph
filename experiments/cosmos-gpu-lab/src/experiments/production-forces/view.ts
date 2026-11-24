import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { positionStats } from './compare'
import { forceCases, forcePositions } from './fixture'
import { createForcePreview, type ForceSession } from './frame'
import './view.css'

export function createForcesView (host: HTMLElement, caseId?: string): ExperimentInstance {
  const fixture = forceCases.find(c => c === caseId) ?? 'gravity'
  const initial = forcePositions(fixture)
  const limit = fixture === 'hierarchy' ? 32 : 8
  host.innerHTML = `<button data-run-action="primary" type="button" data-step>Step once</button>
    <button data-run-action="primary" type="button" data-end>Run to tick ${limit}</button>
    <button data-run-action="primary" type="button" data-reset>Reset</button>
    <div class="package-forces-panels" data-run-part="visualization"></div>
    <p data-force-result data-run-part="status"></p>`
  mountRunLayout(host)
  const panels = host.querySelector<HTMLElement>('.package-forces-panels')!
  const step = host.querySelector<HTMLButtonElement>('[data-step]')!
  const end = host.querySelector<HTMLButtonElement>('[data-end]')!
  const reset = host.querySelector<HTMLButtonElement>('[data-reset]')!
  const result = host.querySelector<HTMLElement>('[data-force-result]')!
  const lanes = (['webgl', 'webgpu'] as const).map(engine => {
    const section = document.createElement('section')
    const heading = document.createElement('h3')
    heading.textContent = engine === 'webgl' ? 'WebGL Graph' : 'WebGPU Graph'
    const surface = document.createElement('div')
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    section.append(heading, surface, status)
    panels.append(section)
    return { engine, surface, status, session: undefined as ForceSession | undefined, xy: undefined as Float32Array | undefined }
  })
  let pending: Promise<void>
  let disposed = false
  let tick = 0

  function run (target: number, reload = false): void {
    if (disposed || reset.disabled) return
    reset.disabled = step.disabled = end.disabled = true
    result.textContent = 'Reading package positions…'
    pending = Promise.all(lanes.map(async lane => {
      try {
        if (reload) {
          lane.session?.destroy()
          lane.session = lane.xy = undefined
          lane.status.textContent = 'Loading package…'
          lane.session = await createForcePreview(lane.surface, lane.engine, fixture)
        }
        if (!lane.session || disposed) return
        lane.xy = await lane.session.advance(reload ? 0 : target - tick)
        const stats = positionStats(lane.xy, initial)
        if (lane.xy[0] !== initial[0] || lane.xy[1] !== initial[1]) throw new Error('Pinned point moved')
        lane.status.textContent = `RMS radius ${stats.radius.toFixed(3)} graph units`
      } catch (error) {
        lane.session?.destroy()
        lane.session = lane.xy = undefined
        lane.status.textContent = String(error)
      }
    })).then(() => {
      if (disposed) return
      tick = target
      const [gl, gpu] = lanes.map(lane => lane.xy)
      if (gl && gpu) {
        const { different, maxDelta, rmsDelta } = positionStats(gpu, gl)
        result.textContent = different
          ? `Tick ${tick}. ${different.toLocaleString()} point positions differ. ` +
            `Largest coordinate difference ${maxDelta.toPrecision(4)}, RMS point difference ${rmsDelta.toPrecision(4)} graph units.`
          : `Tick ${tick}. All ${(gl.length / 2 - 1).toLocaleString()} present point positions match exactly. The pinned point and absent slot are preserved.`
      } else {
        result.textContent = `Tick ${tick}. Both package readbacks are needed to compare positions.`
      }
      reset.disabled = false
      step.disabled = end.disabled = tick >= limit || lanes.every(lane => !lane.session)
    })
  }
  step.onclick = (): void => run(tick + 1)
  end.onclick = (): void => run(limit)
  reset.onclick = (): void => run(0, true)
  run(0, true)
  return {
    destroy (): void {
      disposed = true
      pending.then(() => lanes.forEach(lane => lane.session?.destroy()))
      disposeRunLayout(host)
    },
  }
}
