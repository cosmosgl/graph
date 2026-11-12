import { afterEach, expect, it, vi } from 'vitest'
import { disposeRunLayout, mountRunLayout, summarizeRun } from './run-layout'

let host: HTMLElement | undefined
afterEach(() => { if (host) { disposeRunLayout(host); host.remove() } })

it('preserves controls, listeners and canvas identity while separating diagnostic actions', async () => {
  host = document.createElement('div'); document.body.append(host)
  host.innerHTML = `<p>Unclassified guidance stays in place.</p><div data-run-part="configuration"><select><option>128</option></select></div>
    <button data-run-action="primary">Step</button><button data-run-action="diagnostic">Trace</button>
    <p data-run-part="status" role="status">Preparing</p><section data-run-part="visualization"><canvas></canvas></section>
    <div data-run-part="results"></div>`
  const canvas = host.querySelector('canvas')!; const step = host.querySelector<HTMLButtonElement>('button')!
  let ticks = 0; let verdicts: boolean[] = []
  step.addEventListener('click', () => { ticks++; verdicts = [true, false]; host!.querySelector('[role="status"]')!.textContent = 'Tick complete' })
  mountRunLayout(host, () => summarizeRun('Ready', verdicts, 'Other inputs'))
  expect(host.querySelector('.run-primary-actions button')).toBe(step)
  expect(host.querySelector('.run-diagnostics button')!.textContent).toBe('Trace')
  expect(host.querySelector('.run-visualization canvas')).toBe(canvas)
  expect(host.querySelector('details')).toBeNull()
  step.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-run-summary-value="passed"]')!.textContent).toBe('1 / 2 checks'))
  expect(host.querySelector('[data-run-summary-value="failed"]')!.textContent).toBe('1 failed checks')
  expect(ticks).toBe(1)
  expect(host.lastElementChild!.textContent).toBe('Unclassified guidance stays in place.')
})

it('never turns pending work or benchmark completion into a numerical pass', () => {
  expect(summarizeRun('Complete', [undefined], 'Pixel parity')).toMatchObject({ passed: 'No checks yet', unchecked: 'Pixel parity' })
  expect(summarizeRun('Ready', [true], 'Other fixtures', ['WebGPU'])).toMatchObject({ failed: 'Unavailable: WebGPU' })
  expect(summarizeRun('Ready', [], 'All checks', [], 'Pipeline error')).toMatchObject({ state: 'Failed' })
})

it('keeps guidance accessible and adds scrolling to new result tables without changing their values', async () => {
  host = document.createElement('div'); document.body.append(host)
  host.style.width = '250px'
  host.innerHTML = `<div data-run-part="configuration"><label>Points <select data-control="count"><option>128</option></select></label></div>
    <div data-run-part="results" data-output></div>`
  mountRunLayout(host, () => summarizeRun('Ready', [], 'Other inputs'), { experiment: 'combined-layout', devices: () => ['Test adapter'] })
  const control = host.querySelector('select')!
  const description = document.getElementById(control.getAttribute('aria-describedby')!)!
  expect(description.textContent).toContain('Total simulated points')
  expect(host.querySelector('[data-run-devices]')!.textContent).toBe('Test adapter')
  host.querySelector('[data-output]')!.innerHTML = `<table style="width:1000px"><thead><tr><th>Result</th></tr></thead>
    <tbody><tr><td>Unchecked</td></tr></tbody></table>`
  const table = host.querySelector('table')!
  await vi.waitFor(() => expect(table.parentElement!.classList.contains('result-table-scroll')).toBe(true))
  expect(table.querySelector('th')!.scope).toBe('col')
  expect(table.querySelector('td')!.textContent).toBe('Unchecked')
  expect(table.parentElement!.tabIndex).toBe(0)
})
