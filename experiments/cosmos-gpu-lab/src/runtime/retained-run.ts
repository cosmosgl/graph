import type { ExperimentDefinition, ExperimentInstance } from './experiment'

type Run = {
  id: string; host: HTMLElement; ready: Promise<ExperimentInstance>;
  instance?: ExperimentInstance; visible: boolean; retired: boolean;
}
type MoveTarget = HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }

// Own one GPU session. Retain it across documentation where possible, and keep
// completed evidence if an embedded viewer has to be recreated.
export function createRetainedRun (disposePresentation: (host: HTMLElement) => void = (): void => {}): {
  readonly id: string | undefined;
  show(definition: ExperimentDefinition, parent: HTMLElement): Promise<void>;
  hide(): void;
  destroy(): void;
  } {
  let current: Run | undefined
  let parking: HTMLElement | undefined
  const savedEvidence = new Map<string, unknown>()
  const clearParking = (): void => { parking?.remove(); parking = undefined }
  const hide = (): void => {
    if (!current || !current.visible) return
    current.instance?.pause?.()
    current.visible = false
    if (!current.host.querySelector('iframe')) { current.host.remove(); return }
    const target = document.createElement('div') as MoveTarget
    // A normal DOM removal reloads embedded viewers; unsupported browsers restart them instead.
    if (!current.host.isConnected || typeof target.moveBefore !== 'function') { destroy(); return }
    target.style.cssText = `position:fixed;left:-100000px;top:0;width:${Math.max(1, current.host.getBoundingClientRect().width)}px;` +
      'visibility:hidden;pointer-events:none'
    target.inert = true; target.setAttribute('aria-hidden', 'true')
    document.body.append(target); parking = target
    try { target.moveBefore(current.host, null) } catch { destroy() }
  }
  const destroy = (): void => {
    if (!current) { clearParking(); return }
    const run = current; current = undefined; run.retired = true
    run.instance?.pause?.()
    const evidence = run.instance?.saveEvidence?.()
    if (evidence !== undefined) savedEvidence.set(run.id, evidence)
    disposePresentation(run.host)
    try { run.instance?.destroy() } finally { run.host.remove(); clearParking() }
  }
  return {
    get id (): string | undefined { return current?.id },
    hide,
    destroy,
    async show (definition, parent): Promise<void> {
      if (current?.id !== definition.id) destroy()
      if (!current) {
        const host = document.createElement('div'); host.className = 'experiment-run'
        if (definition.study) host.dataset.studyRun = ''
        host.innerHTML = '<div class="loading">Creating GPU devices…</div>'
        const run: Run = { id: definition.id, host, ready: undefined!, visible: true, retired: false }
        current = run; parent.append(host)
        run.ready = Promise.resolve().then(async () => await definition.create(host)).then(instance => {
          if (run.retired) instance.destroy()
          else {
            const evidence = savedEvidence.get(run.id)
            if (evidence !== undefined && instance.restoreEvidence) {
              instance.restoreEvidence(evidence); savedEvidence.delete(run.id)
            }
            run.instance = instance; if (!run.visible) instance.pause?.()
          }
          return instance
        }).catch(error => {
          if (current === run) { current = undefined; host.remove(); clearParking() }
          throw error
        })
      }
      const run = current; const returning = !run.visible; run.visible = true
      if (run.host.parentElement !== parent) {
        const target = parent as MoveTarget
        if (run.host.isConnected && parent.isConnected && typeof target.moveBefore === 'function') target.moveBefore(run.host, null)
        else parent.append(run.host)
      }
      clearParking()
      await run.ready
      if (returning && current === run && run.visible && !run.retired) run.instance?.resume?.()
    },
  }
}
