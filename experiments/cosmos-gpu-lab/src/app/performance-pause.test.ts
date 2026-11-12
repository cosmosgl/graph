import { expect, it, vi } from 'vitest'
import { createPerformanceLab } from '../experiments/performance-lab/view'
import { createWebGLPointRenderer } from '../experiments/point-rendering/webgl/backend'
import { createWebGPUPointRenderer } from '../experiments/point-rendering/webgpu/backend'
import type { PointRenderMeasurement } from '../experiments/point-rendering/backend'
vi.mock('../experiments/point-rendering/webgl/backend', () => ({ createWebGLPointRenderer: vi.fn() }))
vi.mock('../experiments/point-rendering/webgpu/backend', () => ({ createWebGPUPointRenderer: vi.fn() }))

it.for(['documentation', 'stop button'])('leaves a batch stopped by %s unaccepted and permits a new run', async reason => {
  let finish!: (value: PointRenderMeasurement) => void
  const value = { submitMilliseconds: 1, completionMilliseconds: 2 }
  const measure = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(value)
  const destroy = vi.fn()
  const backend = { setData: vi.fn(), render: vi.fn(), measure, destroy }
  vi.mocked(createWebGLPointRenderer).mockResolvedValue(backend); vi.mocked(createWebGPUPointRenderer).mockResolvedValue(backend)
  const host = document.createElement('div'); document.body.append(host)
  const app = await createPerformanceLab(host)
  const button = (name: string): HTMLButtonElement => host.querySelector(`[data-action="${name}"]`)!
  try {
    button('run').click(); await vi.waitFor(() => expect(measure).toHaveBeenCalledTimes(1))
    if (reason === 'documentation') app.pause!()
    else {
      button('stop').click()
      await vi.waitFor(() => expect(host.querySelector('[data-run-summary-value="state"]')!.textContent).toBe('Stopping'))
    }
    finish(value)
    await vi.waitFor(() => expect(button('run').disabled).toBe(false))
    expect(host.querySelector('[data-output="status"]')!.textContent).toContain('no accepted result')
    expect(button('export').disabled).toBe(true)
    expect(button('stop').disabled).toBe(true)
    await vi.waitFor(() => expect(host.querySelector('[data-run-summary-value="state"]')!.textContent).toBe('Stopped'))
    expect(host.querySelector<HTMLSelectElement>('[data-control="count"]')!.disabled).toBe(false)
    button('run').click()
    await vi.waitFor(() => expect(button('export').disabled).toBe(false))
    expect(host.querySelector('[data-output="status"]')!.textContent).toBe('Benchmark complete.')
  } finally { app.destroy(); host.remove(); vi.restoreAllMocks() }
})
