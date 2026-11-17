import { afterEach, expect, it, vi } from 'vitest'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createLinksView } from './view'
import type { Comparison, ColorResult } from './reference'
import type { Contributions } from './study'
let host: HTMLElement | undefined; let instance: ExperimentInstance | undefined
afterEach(() => { instance?.destroy(); host?.remove(); vi.restoreAllMocks() })
it('keeps rejected controls visible and preserves the live ribbon and ID readout across sweep cancellation', async () => {
  host = document.createElement('div'); document.body.append(host); instance = await createLinksView(host)
  const select = async (selector: string, value: string): Promise<void> => {
    const control = host!.querySelector<HTMLSelectElement>(selector)!
    control.value = value; control.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(control.disabled).toBe(false), { timeout: 20000 })
  }
  let exported: Blob | undefined
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:test' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const checkReport = async (variant: string): Promise<void> => {
    const button = host!.querySelector<HTMLButtonElement>('[data-export]')!
    expect(button.disabled).toBe(false); exported = undefined; button.click()
    expect(exported).toBeDefined()
    const report = JSON.parse(await exported!.text()) as {
      variant: string; comparison: Comparison; production: Comparison; compatibility: Comparison;
      preservation: Record<'webgl' | 'webgpu', ColorResult>; sourceVisibility: Contributions;
    }
    expect(report.variant).toBe(variant)
    const rows = [['Current paths', report.comparison], ['Production controls', report.production],
      ...(variant === 'visible' ? [['Production GL / candidate GPU', report.compatibility]] : [])] as Array<[string, Comparison]>
    expect(Array.from(host!.querySelectorAll('[data-frame] tbody tr'), row => Array.from(row.children, cell => cell.textContent)))
      .toEqual(rows.map(([name, c]) => [name, c.passed ? 'Pass' : 'Fail', String(c.idDifferences),
        `${c.masks.webgl} / ${c.masks.webgpu}`, `${c.colors.budgetFailures} · ${c.colors.maxChannelError}/255`,
        `${c.cpuColors.webgl.budgetFailures} / ${c.cpuColors.webgpu.budgetFailures}`, `${c.invisible.webgl} / ${c.invisible.webgpu}`]))
    // The UI reports the actual audit, including adapter-specific rejections.
    // Rendering tests retain their exact masks, colors and visibility gates.
    const accepted = report.comparison.passed && (['webgl', 'webgpu'] as const).every(lane =>
      report.preservation[lane].changedPixels === 0 && report.sourceVisibility[lane] === 0)
    expect(host!.querySelector('[role="status"]')!.textContent).toContain(accepted ? 'Passed:' : 'not accepted')
  }
  await checkReport('visible')
  expect(host.querySelector('.run-primary-actions [data-compare]')).not.toBeNull()
  await select('[data-variant]', 'production')
  await checkReport('production')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('not accepted')
  expect(host.querySelector('[data-frame]')!.textContent).toContain('Fail')
  await select('[data-variant]', 'visible')
  await checkReport('visible')
  const canvas = host.querySelector<HTMLCanvasElement>('canvas')!
  const inspect = (): void => {
    const box = canvas.getBoundingClientRect()
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: box.left + box.width * 100.5 / 512, clientY: box.top + box.height * 48.5 / 320,
    }))
    for (const lane of ['webgl', 'webgpu']) expect(host!.querySelector(`[data-pick="${lane}"]`)!.textContent).toContain('link 0')
  }
  await select('[data-pattern]', 'dashed')
  await select('[data-gradient]', 'endpoints')
  inspect()
  host.querySelector<HTMLButtonElement>('[data-sweep]')!.click()
  host.querySelector<HTMLButtonElement>('[data-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-progress]')!.textContent).toContain('cancelled'), { timeout: 30000 })
  expect(host.querySelectorAll('[data-links-sweep] tbody tr')).toHaveLength(1)
  expect(host.querySelector<HTMLSelectElement>('[data-pattern]')!.value).toBe('dashed')
  expect(host.querySelector('[data-sweep-results]')!.textContent).toContain('dashed')
  expect(host.querySelector<HTMLSelectElement>('[data-gradient]')!.value).toBe('endpoints')
  expect(host.querySelector('[data-sweep-results]')!.textContent).toContain('endpoints')
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
  host.querySelector<HTMLButtonElement>('[data-raster-replay]')!.click()
  await vi.waitFor(() => expect(host!.querySelectorAll('[data-raster-results] tbody tr').length).toBeGreaterThan(0), { timeout: 30000 })
  host.querySelector<HTMLButtonElement>('[data-raster-cancel]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-raster-progress]')!.textContent).toContain('cancelled'), { timeout: 30000 })
  expect(host.querySelectorAll('[data-raster-results] tbody tr').length).toBeLessThan(48)
  expect(host.querySelector('canvas')).toBe(canvas); inspect()
  expect(host.querySelector<HTMLSelectElement>('[data-variant]')!.value).toBe('visible')
  await checkReport('visible')
  expect(host.querySelector('details')).toBeNull()
}, 90000)
