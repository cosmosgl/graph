import { afterEach, expect, it, vi } from 'vitest'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createLinksView } from './view'
let host: HTMLElement | undefined; let instance: ExperimentInstance | undefined
afterEach(() => { instance?.destroy(); host?.remove() })
it('keeps rejected controls visible and preserves the live ribbon and ID readout across sweep cancellation', async () => {
  host = document.createElement('div'); document.body.append(host); instance = await createLinksView(host)
  const select = async (selector: string, value: string): Promise<void> => {
    const control = host!.querySelector<HTMLSelectElement>(selector)!
    control.value = value; control.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(control.disabled).toBe(false), { timeout: 20000 })
  }
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Passed:')
  expect(host.querySelector('.run-primary-actions [data-compare]')).not.toBeNull()
  await select('[data-variant]', 'production')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('not accepted')
  expect(host.querySelector('[data-frame]')!.textContent).toContain('Fail')
  await select('[data-variant]', 'visible')
  const canvas = host.querySelector<HTMLCanvasElement>('canvas')!
  const inspect = (): void => {
    const box = canvas.getBoundingClientRect()
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: box.left + box.width * 100.5 / 512, clientY: box.top + box.height * 48.5 / 320,
    }))
    for (const lane of ['webgl', 'webgpu']) expect(host!.querySelector(`[data-pick="${lane}"]`)!.textContent).toContain('link 0')
  }
  inspect()
  host.querySelector<HTMLButtonElement>('[data-sweep]')!.click()
  host.querySelector<HTMLButtonElement>('[data-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-progress]')!.textContent).toContain('cancelled'), { timeout: 30000 })
  expect(host.querySelectorAll('[data-links-sweep] tbody tr')).toHaveLength(1)
  expect(host.querySelector('canvas')).toBe(canvas); expect([canvas.width, canvas.height]).toEqual([512, 320])
  expect(host.querySelector<HTMLSelectElement>('[data-variant]')!.value).toBe('visible')
  expect(host.querySelector<HTMLSelectElement>('[data-fixture]')!.value).toBe('ribbons'); inspect()
  expect(host.querySelector<HTMLButtonElement>('[data-export]')!.disabled).toBe(false)
  host.querySelector<HTMLButtonElement>('[data-hard-replay]')!.click()
  await vi.waitFor(() => expect(host!.querySelectorAll('[data-hard-results] tbody tr').length).toBeGreaterThan(0), { timeout: 30000 })
  host.querySelector<HTMLButtonElement>('[data-hard-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-hard-progress]')!.textContent).toContain('cancelled'), { timeout: 30000 })
  expect(host.querySelectorAll('[data-hard-results] tbody tr').length).toBeLessThan(9)
  expect(host.querySelector('canvas')).toBe(canvas); inspect()
  expect(host.querySelector<HTMLSelectElement>('[data-variant]')!.value).toBe('visible')
  expect(host.querySelector('details')).toBeNull()
}, 90000)
