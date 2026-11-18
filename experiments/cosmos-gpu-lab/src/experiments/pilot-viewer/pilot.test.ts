import { expect, test, vi } from 'vitest'
import { assessmentChecks, pixelCheck, type Pixels } from './checks'
import { createView } from './view'
import { member } from './members'
const pixels: Pixels = {
  finite: true,
  samples: 10,
  boundarySamples: 1,
  interiorIdFailures: 0,
  interiorColorFailures: 0,
  invisiblePicks: 0,
  paintedSamples: 5,
  visiblePoints: 34,
}
const timing = { median: 10, p95: 20, max: 30 }
const measured = {
  frames: timing,
  within33: 0.95,
  frameCount: 300,
  validation: pixels,
  interactions: { pick: timing, activePick: timing, drag: timing, exactIds: true, dragPinned: true, pause: true, resume: true, resize: true },
}
test('keeps frame and feedback budgets unchanged and rejects missing samples', () => {
  expect(assessmentChecks(measured).every(row => row.pass)).toBe(true)
  expect(assessmentChecks({ ...measured, within33: 0.949 })[0].pass).toBe(false)
  expect(assessmentChecks({ ...measured, frameCount: 299 })[0].pass).toBe(false)
  expect(assessmentChecks({ ...measured, interactions: { ...measured.interactions, activePick: { ...timing, max: 50.01 } } })[1].pass).toBe(false)
  expect(assessmentChecks({ ...measured, interactions: { ...measured.interactions, pick: { ...timing, max: NaN } } })[1].pass).toBe(false)
})
test('never lets functional success erase color or invisible-picking failures', () => {
  expect(pixelCheck({ ...pixels, interiorColorFailures: 1 }).pass).toBe(false)
  expect(pixelCheck({ ...pixels, invisiblePicks: 1 }).pass).toBe(false)
  expect(assessmentChecks({ ...measured, interactions: { ...measured.interactions, exactIds: false } })[2].pass).toBe(false)
})
test('uses original member identity and weighted connections', () => {
  expect(member(16).neighbors).toEqual([5, 6])
  expect(member(0).neighbors.length).toBe(16)
  expect(member(33).neighbors.length).toBe(17)
  for (const bad of [-1, 34, NaN, 0.5]) expect(() => member(bad)).toThrow('0 to 33')
})
test('updates the native viewer inspector without counting lookup as GPU picking', async () => {
  const host = document.createElement('div'); host.style.width = '960px'; document.body.append(host)
  const instance = await createView(host)
  const click = (selector: string): void => { host.querySelector<HTMLButtonElement>(selector)!.click() }
  try {
    click('[data-action="locate"]')
    await vi.waitFor(() => expect(host.querySelector('[data-selection]')!.textContent).toContain('Member 0 · 16 neighbors'))
    expect(host.querySelectorAll('[data-neighbor]').length).toBe(16)
    expect(host.querySelector('[data-input]')!.textContent).toContain('unchecked')
    click('[data-neighbor="1"]')
    await vi.waitFor(() => expect(host.querySelector('[data-selection]')!.textContent).toContain('Member 1'))
    const input = host.querySelector<HTMLInputElement>('[data-member]')!; input.value = '34'
    click('[data-action="locate"]')
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')!.textContent).toContain('0 to 33'))
    expect(host.querySelector('[data-selection]')!.textContent).toContain('Member 1')
    click('[data-action="reset"]')
    await vi.waitFor(() => expect(host.querySelector('[data-selection]')!.textContent).toContain('Choose a circle'))
    await vi.waitFor(() => expect(host.querySelector('[data-report]')!.textContent).toContain('Sampled CPU pixelsPass'))
  } finally { instance.destroy(); instance.destroy(); host.remove() }
}, 30000)
