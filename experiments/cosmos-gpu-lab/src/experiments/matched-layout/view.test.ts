import { afterEach, expect, it, vi } from 'vitest'
import { createMatchedView } from './view'
vi.mock('../combined-layout/webgl', () => ({ createCombinedWebGL: vi.fn(async () => { throw new Error('Test WebGL unavailable') }) }))
vi.mock('../combined-layout/webgpu', () => ({ createCombinedWebGPU: vi.fn(async () => { throw new Error('Test WebGPU unavailable') }) }))
afterEach(() => { vi.restoreAllMocks() })
it('keeps unavailable lanes explicit, stops the run and exports the partial comparison', async () => {
  const host = document.createElement('div'); document.body.append(host)
  let saved: Blob | undefined
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { saved = blob as Blob; return 'blob:test' })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const app = await createMatchedView(host)
  const button = (action: string): HTMLButtonElement => host.querySelector(`[data-action="${action}"]`)!
  try {
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Partial comparison')
    button('run').click()
    await vi.waitFor(() => expect(button('step').disabled).toBe(false))
    expect(host.querySelector('[data-output="tick"]')!.textContent).toBe('1')
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Partial comparison')
    button('export').click()
    const report = JSON.parse(await saved!.text())
    expect(report.rows[0].complete).toBe(false); expect(report.rows[0].checks).toEqual({})
    expect(report.errors.webgl).toContain('unavailable'); expect(report.errors.webgpu).toContain('unavailable')
    expect(report.rows[0].quality.cpu.shape.finite).toBe(true)
    button('reset').click(); await vi.waitFor(() => expect(button('step').disabled).toBe(false))
    expect(button('export').disabled).toBe(true)
  } finally { app.destroy(); host.remove() }
})
