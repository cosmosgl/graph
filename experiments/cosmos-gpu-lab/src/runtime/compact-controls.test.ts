import { expect, it, vi } from 'vitest'
import { compactRunControls } from './compact-controls'

it('keeps optional controls and diagnostics usable without moving the live result', () => {
  const host = document.createElement('div')
  host.innerHTML = `<section id="run-configuration"><label>Points <select><option>128</option></select></label>
    <label>Mode <select data-mode><option value="a">A</option><option value="b" selected>B</option></select></label></section>
    <section id="run-results">Current result</section>
    <section id="run-diagnostics"><h2>Diagnostics</h2><button>Check</button></section>`
  const mode = host.querySelector<HTMLSelectElement>('[data-mode]')!; const changed = vi.fn()
  mode.addEventListener('change', changed)
  const check = host.querySelector<HTMLButtonElement>('button')!; const clicked = vi.fn()
  check.addEventListener('click', clicked)
  compactRunControls(host, { settings: ['[data-mode]'], diagnostics: true })
  const settings = host.querySelector<HTMLDetailsElement>('#run-configuration details')!
  const diagnostics = host.querySelector<HTMLDetailsElement>('#run-diagnostics details')!
  expect(settings.open).toBe(false); expect(diagnostics.open).toBe(false)
  expect(settings.querySelector('summary')!.textContent).toBe('More settings')
  expect(diagnostics.querySelector('summary')!.textContent).toBe('Additional checks')
  expect(settings.querySelector('label')!.textContent).toContain('Mode')
  settings.querySelector('summary')!.click(); expect(settings.open).toBe(true)
  expect(mode.value).toBe('b'); mode.value = 'a'; mode.dispatchEvent(new Event('change')); expect(changed).toHaveBeenCalledOnce()
  diagnostics.querySelector('summary')!.click(); expect(diagnostics.open).toBe(true)
  check.click(); expect(clicked).toHaveBeenCalledOnce()
  expect(host.querySelector('#run-results')!.textContent).toBe('Current result')
  expect(host.querySelector('#run-results')!.closest('details')).toBeNull()
})
