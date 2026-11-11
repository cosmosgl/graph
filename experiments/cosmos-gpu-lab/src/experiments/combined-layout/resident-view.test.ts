import { expect, it, vi } from 'vitest'
import { createResidentView } from '../resident-layout/view'
import { createResidentComparison } from './resident'
import { benchmarkResidentFrames } from './frame-benchmark'
vi.mock('./resident', () => ({ createResidentComparison: vi.fn() }))
vi.mock('./frame-benchmark', () => ({ FRAME_POLICY: {}, benchmarkResidentFrames: vi.fn() }))
it('keeps cancelled timing rows visible and exportable when the comparison cannot initialize', async () => {
  vi.mocked(createResidentComparison).mockRejectedValue(new Error('Comparison unavailable'))
  let release: () => void = () => {}; let cancelled = false
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.mocked(benchmarkResidentFrames).mockImplementation(async options => {
    options.rows.push({ mode: 'baseline', draw: false, frames: 4, info: 'Test adapter', samples: [], checks: [] })
    options.progress('Timing partial row…'); await gate; cancelled = options.cancelled()
  })
  const host = document.createElement('div'); document.body.append(host)
  const button = (action: string): HTMLButtonElement => host.querySelector(`[data-action="${action}"]`)!
  const app = await createResidentView(host)
  let blob: Blob | undefined
  const url = vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value as Blob; return 'blob:test' })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    button('timing').click()
    await vi.waitFor(() => expect(host.querySelector('[data-output="timing-status"]')!.textContent).toContain('partial row'))
    expect(button('stop-timing').disabled).toBe(false)
    button('stop-timing').click(); release()
    await vi.waitFor(() => expect(button('timing').disabled).toBe(false))
    expect(cancelled).toBe(true)
    expect(host.querySelector('[data-output="timing"]')!.textContent).toContain('Partial')
    expect(button('export').disabled).toBe(false); button('export').click()
    const report = JSON.parse(await blob!.text())
    expect(report.frameTimings).toHaveLength(1); expect(report.rows).toEqual([])
    expect(report.frameTimings[0].samples).toEqual([])
  } finally { release(); app.destroy(); host.remove(); url.mockRestore(); click.mockRestore(); vi.clearAllMocks() }
})
