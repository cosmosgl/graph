import { afterEach, expect, it, vi } from 'vitest'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createCurvesView } from './view'
let host: HTMLElement | undefined; let instance: ExperimentInstance | undefined
// The real GPU view owns the devices; every test must release both lanes.
afterEach(() => { instance?.destroy(); host?.remove() })
it('keeps controls, strict failures and source checks visible while cancelling an offscreen sweep', async () => {
  host = document.createElement('div'); document.body.append(host); instance = await createCurvesView(host)
  const select = async (selector: string, value: string): Promise<void> => {
    const control = host!.querySelector<HTMLSelectElement>(selector)!
    control.value = value; control.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(control.disabled).toBe(false), { timeout: 20000 })
  }
  expect(host.querySelector('.run-primary-actions [data-compare]')).not.toBeNull()
  expect(host.querySelectorAll('[data-curves-frame] tbody tr')).toHaveLength(3)
  expect(host.querySelectorAll('[data-curves-sources] tbody tr')).toHaveLength(2)
  await select('[data-variant]', 'production')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('not accepted')
  await select('[data-variant]', 'visible')
  const canvas = host.querySelector<HTMLCanvasElement>('canvas')!
  const inspect = (): void => {
    const box = canvas.getBoundingClientRect()
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: box.left + box.width * 130.5 / 512, clientY: box.top + box.height * 80.5 / 320,
    }))
    for (const lane of ['webgl', 'webgpu']) expect(host!.querySelector(`[data-pick="${lane}"]`)!.textContent).toContain('link 0')
  }
  inspect()
  host.querySelector<HTMLButtonElement>('[data-sweep]')!.click()
  host.querySelector<HTMLButtonElement>('[data-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-progress]')!.textContent).toContain('cancelled'), { timeout: 30000 })
  expect(host.querySelectorAll('[data-curves-sweep] tbody tr')).toHaveLength(1)
  expect(host.querySelector('canvas')).toBe(canvas); expect([canvas.width, canvas.height]).toEqual([512, 320])
  expect(host.querySelector<HTMLSelectElement>('[data-variant]')!.value).toBe('visible')
  expect(host.querySelector<HTMLSelectElement>('[data-segments]')!.value).toBe('19'); inspect()
  expect(host.querySelector<HTMLButtonElement>('[data-export]')!.disabled).toBe(false)
  await select('[data-opacity]', '0')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Selected policy passed')
  expect(host.querySelector('details')).toBeNull()
}, 90000)
