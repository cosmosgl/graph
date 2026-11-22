import { count as formatCount, milliseconds } from '../../runtime/result-format'
import { renderResultChart } from '../../runtime/result-chart'
import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createCapacitySession, type CapacitySession } from '../combined-layout/capacity-session'
import { CAPACITY_CYCLE, type ResizeReport } from '../combined-layout/capacity'

const startCount = 2048
const pointCounts = [startCount, ...CAPACITY_CYCLE].map(formatCount).join(' → ')
const labels = ['Rebuild GPU buffers', 'Reuse GPU buffers']
const mib = (bytes: number): string => (bytes / 1048576).toFixed(3)

function renderCapacityCharts (host: HTMLElement, reports: readonly ResizeReport[]): void {
  const [rebuild, reuse] = reports
  const context = document.createElement('p')
  context.className = 'result-chart-context'
  context.textContent = `This run · ${formatCount(rebuild.from)} → ${formatCount(rebuild.count)} points`
  host.replaceChildren(context, renderResultChart({
    title: 'Time to remove points',
    unit: 'ms',
    bars: [['Rebuild', rebuild.completionMs], ['Reuse', reuse.completionMs]],
    formatValue: milliseconds,
  }), renderResultChart({
    title: 'Buffer memory after removal',
    unit: 'MiB',
    bars: [['Rebuild', Number(mib(rebuild.after.bytes))], ['Reuse', Number(mib(reuse.after.bytes))]],
  }))
  host.hidden = false
}

export async function createCapacityView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<div class="controls">
    <button data-action="cycle" class="button-primary" data-run-action="primary">Add and remove points</button>
    <button data-action="reset" data-run-action="primary">Reset / retry</button>
  </div>
  <p data-output="status" role="status" data-run-part="status">Preparing both previews…</p>
  <section class="point-shrink-results" id="run-shrink-results" aria-label="Point-count results" hidden></section>
  <section data-run-part="visualization" class="backend-panels">${labels.map((name, lane) => `<article class="backend-panel">
    <div class="panel-heading panel-heading-stacked"><h2>${name}</h2>
      <span data-output="memory-${lane}" class="status">Starting</span></div>
    <canvas data-lane="${lane}" width="480" height="340" aria-label="${name} layout"></canvas>
  </article>`).join('')}</section>`

  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const runButton = el<HTMLButtonElement>('[data-action="cycle"]')
  const resetButton = el<HTMLButtonElement>('[data-action="reset"]')
  const status = el('[data-output="status"]')
  const charts = el('#run-shrink-results')
  mountRunLayout(host, undefined, { experiment: 'point-capacity' })
  el('#run-run').after(charts)

  let session: CapacitySession | undefined
  let destroyed = false
  let busy = false
  let failed = false

  const updateControls = (): void => {
    runButton.disabled = busy || !session || failed
    resetButton.disabled = busy
  }
  const renderReadouts = (current: CapacitySession): void => {
    current.lanes.forEach((lane, index) => {
      el(`[data-output="memory-${index}"]`).textContent =
        `${formatCount(lane.count)} points · room for ${formatCount(lane.capacity)} · ${mib(lane.footprint().bytes)} MiB`
    })
  }
  const perform = async (work: () => Promise<void>): Promise<void> => {
    if (busy || destroyed) return
    busy = true
    updateControls()
    try {
      await work()
    } catch (error) {
      if (!destroyed) {
        failed = true
        status.textContent = String(error)
      }
    } finally {
      busy = false
      if (!destroyed) updateControls()
    }
  }
  const reset = async (): Promise<void> => {
    const previous = session
    session = undefined
    previous?.destroy()
    failed = false
    charts.hidden = true
    charts.replaceChildren()
    status.textContent = 'Preparing both previews…'
    const next = await createCapacitySession(
      { fixture: 'chain', count: startCount, decay: 100, springPrecision: 'trig' },
      lane => el(`[data-lane="${lane}"]`), 'reuse', { checkResizes: false }
    )
    if (destroyed) { next.destroy(); return }
    session = next
    next.render()
    renderReadouts(next)
    status.textContent = `Point counts per run · ${pointCounts}`
  }

  runButton.addEventListener('click', () => perform(async () => {
    const current = session
    if (!current) return
    for (const count of CAPACITY_CYCLE) {
      if (destroyed) return
      await current.resize(count)
      if (destroyed) return
      current.advancePreview()
      renderReadouts(current)
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    if (destroyed) return
    const lastResize = current.resizes.at(-1)
    if (lastResize) renderCapacityCharts(charts, lastResize.reports)
  }))
  resetButton.addEventListener('click', () => perform(reset))

  await perform(reset)
  return {
    destroy (): void {
      disposeRunLayout(host)
      destroyed = true
      session?.destroy()
    },
  }
}
