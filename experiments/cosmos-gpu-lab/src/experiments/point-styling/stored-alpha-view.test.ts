import { expect, it, vi } from 'vitest'
import { createStylingView } from './view'

it('replays stored-alpha picking without changing the live scene and exports its separate policy', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const instance = await createStylingView(host)
  try {
    const canvas = host.querySelector('canvas')!
    const fixture = host.querySelector<HTMLSelectElement>('[data-fixture]')!
    const renderer = host.querySelector<HTMLSelectElement>('[data-renderer]')!
    const before = [fixture.value, renderer.value, canvas.width, canvas.height]
    const replay = host.querySelector<HTMLButtonElement>('[data-stored-alpha]')!
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
