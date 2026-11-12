import { afterEach, expect, it, vi } from 'vitest'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createStylingView } from './view'

let host: HTMLElement | undefined
let instance: ExperimentInstance | undefined
afterEach(() => { instance?.destroy(); host?.remove() })

it('shows the image verdict at startup and keeps the same run when inspecting a pixel', async () => {
  host = document.createElement('div'); document.body.append(host)
  instance = await createStylingView(host)
  await vi.waitFor(() => expect(host!.querySelector('[data-run-summary-value="passed"]')?.textContent).toContain('1 / 1'))
  const canvas = host.querySelector<HTMLCanvasElement>('canvas')!; const box = canvas.getBoundingClientRect()
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + 20, clientY: box.top + 20 }))
  expect(host.querySelectorAll('.run-layout')).toHaveLength(1)
  expect(host.querySelector('canvas')).toBe(canvas)
  expect(host.querySelector('[data-pick]')!.textContent).toContain('Pixel')
  expect(host.querySelector('details')).toBeNull()
})
