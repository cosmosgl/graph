type Preset = { name: string; label: string; values: Record<string, string> }
export function organizeRunControls (
  host: HTMLElement, actions: string[], presets: Preset[], apply: (values: Record<string, string>) => void
): void {
  host.classList.add('compact-run')
  const navigation = document.createElement('nav'); navigation.className = 'run-contents'
  navigation.setAttribute('aria-label', 'Run sections')
  const base = window.location.hash.split('?')[0]
  // Views author these sections explicitly. Notes and outputs keep their intended purpose.
  for (const section of host.querySelectorAll<HTMLElement>(':scope > [data-run-section]')) {
    const name = section.dataset.runSection!
    section.id = `run-${name}`
    const title = name.charAt(0).toUpperCase() + name.slice(1)
    const heading = document.createElement('h2'); heading.textContent = title; heading.id = `${section.id}-title`
    section.prepend(heading); section.setAttribute('aria-labelledby', heading.id)
    const link = document.createElement('a'); link.href = `${base}?section=${section.id}`; link.textContent = title
    link.addEventListener('click', event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      // A section jump must not hide/pause/recreate the running experiment.
      window.history.replaceState(null, '', link.href)
      section.scrollIntoView({ block: 'start' }); section.tabIndex = -1; section.focus({ preventScroll: true })
    })
    navigation.append(link)
  }
  const diagnostics = host.querySelector<HTMLElement>('[data-run-section="diagnostics"]')!
  const diagnosticActions = document.createElement('div'); diagnosticActions.className = 'controls'
  for (const name of actions) {
    const button = host.querySelector(`[data-action="${name}"]`)
    if (button) diagnosticActions.append(button)
  }
  diagnostics.querySelector('h2')!.after(diagnosticActions)
  const choices = document.createElement('div'); choices.className = 'run-presets'
  const label = document.createElement('p'); label.className = 'demo-note'; label.textContent = 'Start from a preset · replaces the current run'
  choices.append(label)
  const buttons = document.createElement('div'); buttons.className = 'controls'
  for (const preset of presets) {
    const button = document.createElement('button'); button.textContent = preset.label; button.dataset.runPreset = preset.name
    button.addEventListener('click', () => apply(preset.values)); buttons.append(button)
  }
  const current = document.createElement('p'); current.className = 'demo-note'; current.dataset.liveSettings = ''
  choices.append(buttons, current)
  host.querySelector('[data-run-section="configuration"] > h2')!.after(choices)
  host.prepend(navigation)
}
