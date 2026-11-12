type Preset = { name: string; label: string; values: Record<string, string> }
export function organizeRunControls (
  host: HTMLElement, actions: string[], presets: Preset[], apply: (values: Record<string, string>) => void
): void {
  host.classList.add('compact-run')
  const diagnostics = host.querySelector<HTMLElement>('[data-run-section="diagnostics"]')!
  const diagnosticActions = document.createElement('div'); diagnosticActions.className = 'controls'
  for (const name of actions) {
    const button = host.querySelector(`[data-action="${name}"]`)
    if (button) { (button as HTMLElement).dataset.runAction = 'diagnostic'; diagnosticActions.append(button) }
  }
  diagnostics.prepend(diagnosticActions)
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
  host.querySelector('[data-run-section="configuration"]')!.prepend(choices)
}
