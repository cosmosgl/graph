import type { ExperimentDefinition, ExperimentInstance } from './experiment'

type Run = {
  id: string; host: HTMLElement; ready: Promise<ExperimentInstance>;
  instance?: ExperimentInstance; visible: boolean; retired: boolean;
}

// One run, not a cache of GPU sessions. Its DOM and resources survive visits to
// documentation, including while asynchronous setup is still finishing.
export function createRetainedRun (disposePresentation: (host: HTMLElement) => void = (): void => {}): {
  readonly id: string | undefined;
  show(definition: ExperimentDefinition, parent: HTMLElement): Promise<void>;
  hide(): void;
  destroy(): void;
  } {
  let current: Run | undefined
  const hide = (): void => {
    if (!current) return
    if (current.visible) current.instance?.pause?.()
    current.visible = false; current.host.remove()
  }
  const destroy = (): void => {
    if (!current) return
    const run = current; current = undefined; run.retired = true
    run.instance?.pause?.(); disposePresentation(run.host); run.host.remove(); run.instance?.destroy()
  }
  return {
    get id (): string | undefined { return current?.id },
    hide,
    destroy,
    async show (definition, parent): Promise<void> {
      if (current?.id !== definition.id) destroy()
      if (!current) {
        const host = document.createElement('div'); host.className = 'experiment-run'
        host.innerHTML = '<div class="loading">Creating GPU devices…</div>'
        const run: Run = { id: definition.id, host, ready: undefined!, visible: true, retired: false }
        current = run; parent.append(host)
        run.ready = Promise.resolve().then(async () => await definition.create(host)).then(instance => {
          if (run.retired) instance.destroy()
          else { run.instance = instance; if (!run.visible) instance.pause?.() }
          return instance
        }).catch(error => {
          if (current === run) { current = undefined; host.remove() }
          throw error
        })
      }
      const run = current; run.visible = true; parent.append(run.host)
      await run.ready
    },
  }
}
