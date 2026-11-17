import { expect, it, vi } from 'vitest'
import { createStylingView } from './view'
import type { Settings } from './data'
import type { EffectsRow } from './effects-study'

it('exports the selected overlay candidate and retains it across production and sweep cancellation', async () => {
  let exported: Blob | undefined
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:test' })
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const host = document.createElement('div'); document.body.append(host)
  let instance: Awaited<ReturnType<typeof createStylingView>> | undefined
  try {
    instance = await createStylingView(host)
    const select = async (selector: string, value: string): Promise<void> => {
      const control = host.querySelector<HTMLSelectElement>(selector)!
      control.value = value; control.dispatchEvent(new Event('change'))
      await vi.waitFor(() => expect(control.disabled).toBe(false), { timeout: 20000 })
    }
    const report = async (): Promise<{
      settings: Settings; effects?: { overlayArithmetic: Record<'webgl' | 'webgpu', string> }; effectsSweep?: { rows: EffectsRow[] };
    }> => {
      exported = undefined; host.querySelector<HTMLButtonElement>('[data-export]')!.click()
      expect(exported).toBeDefined()
      return JSON.parse(await exported!.text())
    }
    const overlay = host.querySelector<HTMLSelectElement>('[data-overlay-arithmetic]')!
    expect(overlay.disabled).toBe(true)
    await select('[data-fixture]', 'point-effects')
    await select('[data-effects-scene]', 'overlap')
    await select('[data-overlay-arithmetic]', 'pixels')
    const selected = await report()
    expect(selected.settings.overlayArithmetic).toBe('pixels')
    expect(selected.effects!.overlayArithmetic).toEqual({ webgl: 'pixels', webgpu: 'pixels' })
    expect(host.querySelector('[data-legend]')!.textContent).toContain('pixel-distance candidate')
    await select('[data-renderer]', 'production')
    expect(overlay.disabled).toBe(true)
    expect((await report()).effects!.overlayArithmetic).toEqual({ webgl: 'normalized', webgpu: 'normalized' })
    expect(host.querySelector('[data-legend]')!.textContent).toContain('interpolated control')
    await select('[data-renderer]', 'eligibility')
    expect(overlay.value).toBe('pixels')
    host.querySelector<HTMLButtonElement>('[data-effects-sweep]')!.click()
    host.querySelector<HTMLButtonElement>('[data-effects-cancel]')!.click()
    await vi.waitFor(() => expect(host.querySelector('[data-effects-progress]')!.textContent).toContain('cancelled'), { timeout: 30000 })
    const rows = (await report()).effectsSweep!.rows
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.settings.overlayArithmetic === 'pixels')).toBe(true)
    expect(host.querySelector('[data-effects-results]')!.textContent).toContain('pixel-distance candidate')
    expect(overlay.value).toBe('pixels'); expect(overlay.disabled).toBe(false)
    expect(host.querySelector('details')).toBeNull()
  } finally { instance?.destroy(); host.remove(); createUrl.mockRestore(); revokeUrl.mockRestore(); download.mockRestore() }
}, 90000)
