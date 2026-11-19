type CompactOptions = { settings?: string[]; diagnostics?: boolean }

// Move the original nodes rather than recreating them: selected values, labels
// and event handlers must keep working when the disclosure is opened.
export function compactRunControls (host: HTMLElement, options: CompactOptions): void {
  const configuration = host.querySelector<HTMLElement>('#run-configuration')
  if (configuration && options.settings?.length) {
    const labels = new Set<HTMLLabelElement>()
    for (const selector of options.settings) {
      for (const control of configuration.querySelectorAll<HTMLElement>(selector)) {
        const label = control.closest('label')
        if (label && configuration.contains(label)) labels.add(label)
      }
    }
    if (labels.size) {
      const details = document.createElement('details'); details.className = 'advanced-controls'
      const summary = document.createElement('summary'); summary.textContent = 'More settings'
      const contents = document.createElement('div'); contents.className = 'scale-toolbar'
      contents.append(...labels); details.append(summary, contents); configuration.append(details)
    }
  }
  const diagnostics = host.querySelector<HTMLElement>('#run-diagnostics')
  if (options.diagnostics && diagnostics?.children.length) {
    const details = document.createElement('details'); details.className = 'advanced-controls'
    const summary = document.createElement('summary'); summary.textContent = 'Additional checks'
    details.append(summary, ...Array.from(diagnostics.childNodes)); diagnostics.append(details)
  }
}
