import type { ExperimentInstance } from '../../runtime/experiment'
import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
import type { Fixture, Settings } from '../combined-layout/data'
import { createResidentComparison, type ResidentComparison } from '../combined-layout/resident'

const settings = { fixture: 'chain', count: 128, decay: 20, checkpointEvery: 5, springPrecision: 'trig' } satisfies Settings
const previews = [
  { label: 'CPU bounds', description: 'Copies positions to the CPU each step.' },
  { label: 'GPU bounds', description: 'Uses positions already on the GPU.' },
]

export async function createResidentView (host: HTMLElement, purpose: 'compare' | 'edit'): Promise<ExperimentInstance> {
  const editing = purpose === 'edit'
  const afterPreview = editing
    ? `<div class="scale-toolbar" data-run-part="visualization">
      <label>New links <select data-edit-links><option value="communities">Communities</option>
        <option value="chain">Chain</option><option value="star">Star</option><option value="empty">No links</option></select></label>
      <button data-action="links">Replace links</button>
    </div>`
    : `<p class="demo-note" data-run-part="visualization">Chain graph · ${settings.count} points · ${settings.decay} steps</p>`
  host.innerHTML = `<div class="controls">
    <button class="button-primary" data-run-action="primary" data-action="run">${editing ? 'Advance one step' : 'Run comparison'}</button>
    ${editing ? '<button data-run-action="primary" data-action="pin">Move and pin first point</button>' : ''}
    <button data-run-action="primary" data-action="reset">Reset / retry</button>
  </div>
  ${editing
    ? `<p class="demo-note" data-run-part="visualization">Both previews get the same edit.
      Advance one step to check whether the layouts still match.</p>`
    : ''}
  <section class="backend-panels" data-run-part="visualization">${previews.map(({ label, description }, lane) => `<article class="backend-panel">
    <div class="panel-heading"><h2>${label}</h2></div>
    ${editing ? '' : `<p class="demo-note">${description}</p>`}
    <canvas data-lane="${lane}" width="480" height="340" aria-label="${label} layout"></canvas>
    ${editing
    ? ''
    : '<dl><div><dt>Bounds downloads</dt><dd data-bounds-downloads>0</dd></div></dl>'}
  </article>`).join('')}</section>
  ${afterPreview}
  <p role="status" data-output="status" data-run-part="status">Preparing both previews…</p>`
  mountRunLayout(host)
  const canvas = (resident: boolean): HTMLCanvasElement => host.querySelector<HTMLCanvasElement>(`[data-lane="${resident ? 1 : 0}"]`)!
  const run = host.querySelector<HTMLButtonElement>('[data-action="run"]')!
  const reset = host.querySelector<HTMLButtonElement>('[data-action="reset"]')!
  const pin = host.querySelector<HTMLButtonElement>('[data-action="pin"]')
  const replaceLinks = host.querySelector<HTMLButtonElement>('[data-action="links"]')
  const links = host.querySelector<HTMLSelectElement>('[data-edit-links]')
  const status = host.querySelector<HTMLElement>('[data-output="status"]')!
  const readouts = host.querySelectorAll<HTMLElement>('[data-bounds-downloads]')

  let session: ResidentComparison | undefined
  let busy = false
  let failed = false
  let destroyed = false
  let pauseRequested = false

  const updateDownloads = (current?: ResidentComparison): void => {
    readouts.forEach((readout, lane) => {
      const downloads = String(current?.readbacks[lane].bounds ?? 0)
      if (readout.textContent !== downloads) readout.textContent = downloads
    })
  }
  const updateControls = (): void => {
    const unavailable = busy || !session || failed || (editing && session.tick() === settings.decay)
    run.disabled = unavailable
    reset.disabled = busy
    if (pin && replaceLinks && links) {
      pin.disabled = unavailable
      replaceLinks.disabled = unavailable
      links.disabled = unavailable
    }
  }
  const perform = async (work: () => Promise<void>): Promise<void> => {
    if (busy || destroyed) return
    busy = true; updateControls()
    try {
      await work()
    } catch (error) {
      failed = true
      if (!destroyed) status.textContent = `${error instanceof Error ? error.message : String(error)}. Use Reset / retry to restart.`
    } finally {
      busy = false
      if (!destroyed) updateControls()
    }
  }
  const prepare = async (): Promise<void> => {
    session?.destroy()
    session = undefined
    failed = false
    if (!editing) run.textContent = 'Run comparison'
    updateDownloads()
    status.textContent = 'Preparing both previews…'
    const next = await createResidentComparison(settings, canvas)
    if (destroyed) { next.destroy(); return }
    session = next
    next.render()
    status.textContent = editing
      ? 'Step 0 · Advance the layout, then try an edit.'
      : 'Ready · Press Run comparison to count bounds downloads.'
  }
  run.addEventListener('click', () => perform(async () => {
    if (editing) {
      const current = session!
      const check = await current.step(true)
      if (destroyed) return
      current.render()
      failed = check?.valid === false
      const verdict = failed ? 'The layouts differed.' : 'The layouts matched.'
      const done = current.tick() === settings.decay ? ' Reset / retry to start again.' : ''
      status.textContent = `Step ${current.tick()} · ${verdict}${done}`
      return
    }
    pauseRequested = false
    if (session!.tick() === settings.decay || session!.rows.at(-1)?.valid === false) await prepare()
    if (destroyed) return
    const current = session!
    status.textContent = 'Comparing layouts…'
    while (current.tick() < settings.decay) {
      if (destroyed) return
      if (pauseRequested) {
        status.textContent = `Paused at step ${current.tick()} of ${settings.decay}.`
        run.textContent = 'Continue comparison'
        return
      }
      const check = await current.step()
      if (destroyed) return
      current.render()
      updateDownloads(current)
      if (check?.valid === false) break
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    if (destroyed) return
    run.textContent = 'Run comparison'
    const lastCheck = current.rows.at(-1)
    status.textContent = lastCheck?.valid === false
      ? `The layout check failed at step ${lastCheck.tick}.`
      : `Bit-for-bit match (${current.rows.filter(check => check.valid).length}/${current.rows.length} checkpoints)`
  }))
  reset.addEventListener('click', () => perform(prepare))
  pin?.addEventListener('click', () => perform(async () => {
    session!.patchPoint(0, new Float32Array([-32, 16, 1, 0]))
    session!.render()
    status.textContent = `Step ${session!.tick()} · First point moved and pinned.`
  }))
  replaceLinks?.addEventListener('click', () => perform(async () => {
    session!.replaceLinks(links!.value as Fixture | 'empty')
    session!.render()
    status.textContent = `Step ${session!.tick()} · Links replaced. Advance to see the layout respond.`
  }))
  await perform(prepare)
  return {
    pause (): void { pauseRequested = true },
    destroy (): void {
      destroyed = true
      disposeRunLayout(host)
      session?.destroy()
    },
  }
}
