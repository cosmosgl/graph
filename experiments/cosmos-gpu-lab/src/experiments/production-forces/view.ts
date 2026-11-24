import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { combinedMetrics, positionStats } from './compare'
import { absentIndex, forceCases, forcePositions } from './fixture'
import { createForcePreview, type ForceSession } from './frame'
import { isScaleCase, scaleFixture } from './scale-fixture'
import { scaleCheckpoints, scaleMetrics } from './scale-metrics'
import './view.css'

export function createForcesView (host: HTMLElement, caseId?: string): ExperimentInstance {
  const fixture = forceCases.find(c => c === caseId) ?? 'gravity'
  const initial = forcePositions(fixture)
  const scaled = isScaleCase(fixture) ? scaleFixture(fixture) : undefined
  const hole = scaled ? 1 : absentIndex
  const limit = scaled ? 100 : fixture === 'hierarchy' ? 32 : 8
  const combined = fixture === 'combined'
  const checkpointControl = scaled
    ? `<label data-run-action="primary">Checkpoint <select data-checkpoint>
         ${scaleCheckpoints.filter(n => n > 0).map(n => `<option value="${n}"${n === 8 ? ' selected' : ''}>Tick ${n}</option>`).join('')}
       </select></label>`
    : ''
  host.innerHTML = `<button data-run-action="primary" type="button" data-step>Step once</button>
    ${checkpointControl}
    <button data-run-action="primary" type="button" data-end>${scaled ? 'Run to checkpoint' : `Run to tick ${limit}`}</button>
    <button data-run-action="primary" type="button" data-reset>Reset</button>
    <div class="package-forces-panels" data-run-part="visualization"></div>
    <p data-force-result data-run-part="status"></p>`
  mountRunLayout(host)
  const panels = host.querySelector<HTMLElement>('.package-forces-panels')!
  const step = host.querySelector<HTMLButtonElement>('[data-step]')!
  const end = host.querySelector<HTMLButtonElement>('[data-end]')!
  const reset = host.querySelector<HTMLButtonElement>('[data-reset]')!
  const checkpoint = host.querySelector<HTMLSelectElement>('[data-checkpoint]')
  const result = host.querySelector<HTMLElement>('[data-force-result]')!
  const lanes = (['webgl', 'webgpu'] as const).map(engine => {
    const section = document.createElement('section')
    const heading = document.createElement('h3')
    heading.textContent = engine === 'webgl' ? 'WebGL Graph' : 'WebGPU Graph'
    const surface = document.createElement('div')
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    section.append(heading, surface, status)
    const details = document.createElement('p')
    const pick = document.createElement('output')
    if (combined || scaled) {
      pick.dataset.forcePick = ''
      pick.setAttribute('aria-label', `${heading.textContent} click result`)
      section.append(details, pick)
    }
    panels.append(section)
    return { engine, surface, status, details, pick, session: undefined as ForceSession | undefined, xy: undefined as Float32Array | undefined }
  })
  let pending: Promise<void>
  let disposed = false
  let tick = 0

  function run (target: number, reload = false): void {
    if (disposed || reset.disabled) return
    reset.disabled = step.disabled = end.disabled = true
    if (checkpoint) checkpoint.disabled = true
    result.textContent = 'Reading package positions…'
    pending = Promise.all(lanes.map(async lane => {
      try {
        if (reload) {
          lane.session?.destroy()
          lane.session = lane.xy = undefined
          lane.status.textContent = 'Loading package…'
          lane.pick.textContent = 'Click a link or point'
          lane.details.textContent = ''
          lane.session = await createForcePreview(lane.surface, lane.engine, fixture, {
            onPick: id => { lane.pick.textContent = id },
          })
        }
        if (!lane.session || disposed) return
        const previous = lane.xy ?? initial
        lane.xy = await lane.session.advance(reload ? target : target - tick)
        const stats = positionStats(lane.xy, initial, hole)
        for (const pin of scaled?.pinned ?? [0]) {
          if (lane.xy[2 * pin] !== initial[2 * pin] || lane.xy[2 * pin + 1] !== initial[2 * pin + 1]) throw new Error(`Pinned point ${pin} moved`)
        }
        lane.status.textContent = `RMS radius ${stats.radius.toFixed(3)} graph units`
        if (scaled) {
          const metrics = scaleMetrics(scaled, lane.xy)
          const displacement = positionStats(lane.xy, previous, hole).rmsDelta
          const minRetained = Math.min(...metrics.communities.map(c => c.retainedFraction))
          const layout = fixture === 'dense'
            ? `Each community retains at least ${(100 * minRetained).toFixed(1)}% of its original members.`
            : `Hub ${metrics.hub.id} moved ${metrics.hub.displacement.toFixed(2)} graph units.`
          lane.details.textContent = `${layout} RMS movement ${displacement.toFixed(2)} graph units since tick ${reload ? 0 : tick}. ` +
            `${metrics.overlap.pairs.toLocaleString()} overlapping pairs. RMS spring-length error ${metrics.springRmsError.toFixed(2)} graph units.`
        } else if (combined) {
          const { penetration, linkLengths } = combinedMetrics(lane.xy)
          const displacement = positionStats(lane.xy, previous).rmsDelta
          lane.details.textContent = `Points 1 and 2 overlap by ${penetration.toFixed(3)}. ` +
            `Links 0 and 1 measure ${linkLengths.map(v => v.toFixed(3)).join(' and ')}. ` +
            `RMS movement since tick ${reload ? 0 : tick} is ${displacement.toFixed(3)} graph units.`
          lane.pick.textContent = 'Click a link or point'
        }
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
        const { different, maxDelta, rmsDelta } = positionStats(gpu, gl, hole)
        result.textContent = different
          ? `Tick ${tick}. ${different.toLocaleString()} point positions differ. ` +
            `Largest coordinate difference ${maxDelta.toPrecision(4)}, RMS point difference ${rmsDelta.toPrecision(4)} graph units.`
          : `Tick ${tick}. All ${(gl.length / 2 - 1).toLocaleString()} present point positions match exactly. The pinned point and absent slot are preserved.`
        if (combined && tick === limit) result.textContent += ' Click halfway along the descending link from the orange point in either preview.'
      } else {
        result.textContent = `Tick ${tick}. Both package readbacks are needed to compare positions.`
      }
      reset.disabled = false
      const unavailable = lanes.every(lane => !lane.session)
      step.disabled = tick >= limit || unavailable
      end.disabled = checkpoint ? unavailable : step.disabled
      if (checkpoint) checkpoint.disabled = unavailable
    })
  }
  step.onclick = (): void => run(tick + 1)
  end.onclick = (): void => {
    const target = checkpoint ? Number(checkpoint.value) : limit
    run(target, target < tick)
  }
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
