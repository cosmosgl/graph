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
