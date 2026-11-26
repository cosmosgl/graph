import type { ExperimentInstance } from '../../runtime/experiment'
import { count, milliseconds } from '../../runtime/result-format'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { createCapacitySession, type CapacitySession } from '../combined-layout/capacity-session'

const startCount = 2048
const endCount = 8192
const labels = ['Copy through CPU', 'Copy on GPU']

export async function createBufferCopyView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<button class="button-primary" data-run-action="primary" disabled>Add points</button>
    <section data-run-part="visualization" class="backend-panels">${labels.map(label => `<article class="backend-panel">
      <div class="panel-heading"><h2>${label}</h2></div>
      <canvas width="480" height="340" aria-label="${label} layout"></canvas>
      <dl><div><dt>Position data downloaded to the CPU</dt><dd data-download>Not measured</dd></div></dl>
      <p class="run-source">Total rebuild time · <span data-time>—</span></p>
    </article>`).join('')}</section>
    <p data-run-part="status" role="status">Preparing the chain…</p>`
  mountRunLayout(host)
  const add = host.querySelector<HTMLButtonElement>('[data-run-action="primary"]')!
  const status = host.querySelector<HTMLElement>('[role="status"]')!
  const canvases = host.querySelectorAll('canvas')
  const downloads = host.querySelectorAll<HTMLElement>('[data-download]')
  const times = host.querySelectorAll<HTMLElement>('[data-time]')
  let session: CapacitySession | undefined
  let busy = false
  let destroyed = false

  async function run (grow: boolean): Promise<void> {
    if (busy || destroyed) return
    busy = true
    add.disabled = true
    try {
      if (!session || session.lanes[0].count !== startCount) {
        session?.destroy()
        session = undefined
        downloads.forEach(value => { value.textContent = 'Not measured' })
        times.forEach(value => { value.textContent = '—' })
        status.textContent = 'Preparing the chain…'
        session = await createCapacitySession(
          { fixture: 'chain', count: startCount, decay: 100, springPrecision: 'trig' },
          lane => canvases[lane], 'transfer', { checkResizes: false }
        )
        if (destroyed) return
        session.render()
        status.textContent = `Chain graph · ${count(startCount)} points`
      }
      if (!grow) return
      status.textContent = `Adding points to reach ${count(endCount)}…`
      const { reports } = await session.resize(endCount)
      if (destroyed) return
      session.render()
      reports.forEach((report, lane) => {
        downloads[lane].textContent = `${report.downloadedBytes / 1024} KiB`
        times[lane].textContent = `${milliseconds(report.completionMs)} ms`
      })
      status.textContent = `Chain graph · ${count(startCount)} → ${count(endCount)} points`
    } catch (error) {
      session?.destroy()
      session = undefined
      if (!destroyed) status.textContent = `${String(error)}. Select Add points to retry.`
    } finally {
      busy = false
      if (destroyed) session?.destroy()
      else add.disabled = false
    }
  }

  add.addEventListener('click', () => run(true))
  await run(false)
  return {
    destroy (): void {
      destroyed = true
      disposeRunLayout(host)
      if (!busy) session?.destroy()
    },
  }
}
