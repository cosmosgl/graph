import { expect, it, vi } from 'vitest'
import { createStylingView } from './view'

it('replays stored-alpha picking without changing the live scene and exports its separate policy', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const instance = await createStylingView(host, 'picking')
  try {
    const canvas = host.querySelector('canvas')!
    const fixture = host.querySelector<HTMLSelectElement>('[data-fixture]')!
    const renderer = host.querySelector<HTMLSelectElement>('[data-renderer]')!
    const before = [fixture.value, renderer.value, canvas.width, canvas.height]
    const replay = host.querySelector<HTMLButtonElement>('[data-stored-alpha]')!
    expect(replay.closest<HTMLElement>('[data-case-diagnostic]')!.hidden).toBe(false)
    expect(replay.disabled).toBe(false); replay.click()
    expect(fixture.disabled).toBe(true)
    await vi.waitFor(() => expect(host.querySelector('[data-stored-progress]')!.textContent).toContain('Pass · 6 live rows'), { timeout: 20000 })
    expect(host.querySelectorAll('[data-stored-results] tbody tr')).toHaveLength(6)
    expect([fixture.value, renderer.value, canvas.width, canvas.height]).toEqual(before)
    expect(fixture.disabled).toBe(false); expect(replay.disabled).toBe(false)
    expect(host.querySelector('details')).toBeNull()
    let exported: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:test' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    host.querySelector<HTMLButtonElement>('[data-export]')!.click()
    const report = JSON.parse(await exported!.text())
    expect(report.storedAlphaReplay).toMatchObject({ policy: 'stored-alpha-v1', status: 'passed' })
    expect(report.storedAlphaReplay.rows).toHaveLength(6)
    expect(report.storedAlphaReplay.startedAt).toBeTruthy(); expect(report.storedAlphaReplay.finishedAt).toBeTruthy()
    expect(report.storedAlphaReplay.rows.every((r: { backend: string }) => r.backend.length > 0)).toBe(true)
  } finally { vi.restoreAllMocks(); instance.destroy(); host.remove() }
}, 60000)

it('cancels a cost sweep and exports complete rows without changing the live scene', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const instance = await createStylingView(host, 'picking')
  try {
    const fixture = host.querySelector<HTMLSelectElement>('[data-fixture]')!
    const before = fixture.value
    const run = host.querySelector<HTMLButtonElement>('[data-stored-cost]')!
    const cancel = host.querySelector<HTMLButtonElement>('[data-stored-cost-cancel]')!
    run.click(); expect(run.disabled).toBe(true); expect(cancel.disabled).toBe(false)
    await vi.waitFor(() => expect(host.querySelectorAll('[data-stored-cost-results] tbody tr').length).toBeGreaterThan(0), { timeout: 20000 })
    cancel.click()
    await vi.waitFor(() => expect(host.querySelector('[data-stored-cost-progress]')!.textContent).toContain('cancelled'), { timeout: 20000 })
    expect(fixture.value).toBe(before); expect(fixture.disabled).toBe(false)
    expect(run.disabled).toBe(false); expect(cancel.disabled).toBe(true)
    let exported: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:test' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    host.querySelector<HTMLButtonElement>('[data-export]')!.click()
    const report = JSON.parse(await exported!.text()).storedAlphaCost
    expect(report.status).toBe('cancelled'); expect(report.finishedAt).toBeTruthy()
    expect(report.rows.length).toBeGreaterThan(0); expect(report.rows.length).toBeLessThan(16)
    for (const row of report.rows) {
      expect(row.valid).toBe(true); expect(row.normal).toHaveLength(5); expect(row.profiled).toHaveLength(5)
    }
  } finally { vi.restoreAllMocks(); instance.destroy(); host.remove() }
}, 60000)

it('cancels a filtered comparison and exports complete rows without changing the live scene', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const instance = await createStylingView(host, 'picking')
  try {
    const fixture = host.querySelector<HTMLSelectElement>('[data-fixture]')!
    const before = fixture.value
    const run = host.querySelector<HTMLButtonElement>('[data-filtered-cost]')!
    const cancel = host.querySelector<HTMLButtonElement>('[data-filtered-cost-cancel]')!
    run.click(); expect(run.disabled).toBe(true); expect(cancel.disabled).toBe(false)
    await vi.waitFor(() => expect(host.querySelectorAll('[data-filtered-cost-results] tbody tr').length).toBeGreaterThan(0), { timeout: 20000 })
    cancel.click()
    await vi.waitFor(() => expect(host.querySelector('[data-filtered-cost-progress]')!.textContent).toContain('cancelled'), { timeout: 20000 })
    expect(fixture.value).toBe(before); expect(fixture.disabled).toBe(false)
    expect(run.disabled).toBe(false); expect(cancel.disabled).toBe(true)
    let exported: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:test' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    host.querySelector<HTMLButtonElement>('[data-export]')!.click()
    const report = JSON.parse(await exported!.text()).filteredStoredAlphaCost
    expect(report.status).toBe('cancelled'); expect(report.finishedAt).toBeTruthy()
    expect(report.rows.length).toBeGreaterThan(0); expect(report.rows.length).toBeLessThan(16)
    for (const row of report.rows) {
      expect(row.valid).toBe(true); expect(row.prototype).toHaveLength(5); expect(row.filtered).toHaveLength(5)
      expect(row.filteredPasses).toBe(1 + row.candidates * 3)
    }
  } finally { vi.restoreAllMocks(); instance.destroy(); host.remove() }
}, 60000)
