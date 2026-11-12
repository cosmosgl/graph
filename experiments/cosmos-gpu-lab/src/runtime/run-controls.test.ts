import { afterEach, expect, it } from 'vitest'
import { organizeRunControls } from './run-controls'
import { disposeRunLayout, mountRunLayout } from './run-layout'
const original = window.location.href
let host: HTMLElement
afterEach(() => { disposeRunLayout(host); host.remove(); window.history.replaceState(null, '', original) })

it('keeps essential settings visible, respects authored sections and jumps without restarting the run', () => {
  window.history.replaceState(null, '', '#/collision/run')
  host = document.createElement('div'); document.body.append(host)
  host.innerHTML = `<section data-run-section="configuration"><p class="demo-note">Technical note</p><div class="scale-toolbar">
    <label>Points<select data-control="count"><option>128</option></select></label>
    <label>Arithmetic<select data-control="precision"><option>trig</option></select></label></div></section>
    <section data-run-section="run">
    <div class="playback-toolbar"><button data-action="run">Run</button><button data-action="timing">Time</button></div>
    <div class="backend-panels"><canvas></canvas></div></section>
    <section data-run-section="results"></section><section data-run-section="diagnostics"></section>`
  const timing = host.querySelector<HTMLButtonElement>('[data-action="timing"]')!; let clicks = 0
  timing.addEventListener('click', () => { clicks++ })
  let chosen: Record<string, string> | undefined
  organizeRunControls(host, ['timing'], [{ name: 'simple', label: 'Simple case', values: { count: '128' } }], values => { chosen = values })
  mountRunLayout(host, () => ({ state: 'Ready', passed: 'No checks yet', failed: 'None', unchecked: 'All fixtures' }))
  expect(host.querySelector('[data-control="count"]')!.closest('details')).toBeNull()
  expect(host.querySelector('[data-control="precision"]')!.closest('details')).toBeNull()
  expect(host.querySelector('#run-diagnostics button')).toBe(timing); timing.click(); expect(clicks).toBe(1)
  expect(host.querySelector('#run-configuration [data-run-section="configuration"] > p')!.textContent).toBe('Technical note')
  expect(Array.from(host.querySelectorAll('.run-settings > h2, .run-display > section > h2, .run-diagnostics > h2'), h => h.textContent))
    .toEqual(['Configuration', 'Run', 'Results', 'Diagnostics'])
  host.querySelector<HTMLAnchorElement>('nav a[href$="section=run-results"]')!.click()
  expect(window.location.hash).toBe('#/collision/run?section=run-results')
  expect(document.activeElement?.id).toBe('run-results')
  expect(host.querySelector('canvas')).not.toBeNull()
  expect(chosen).toBeUndefined(); host.querySelector<HTMLButtonElement>('[data-run-preset="simple"]')!.click()
  expect(chosen).toEqual({ count: '128' })
})
