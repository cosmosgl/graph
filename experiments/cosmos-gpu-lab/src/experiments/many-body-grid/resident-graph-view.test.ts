import { expect, it, vi } from 'vitest'
import { createMillionGraphView } from '../million-graph/view'

it.each(['clusters', 'persistent-communities'])('runs, pauses and resets the visible resident graph with a %s start', async (start) => {
  const host = document.createElement('div'); document.body.append(host)
  const view = await createMillionGraphView(host)
  const find = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  try {
    const count = find<HTMLSelectElement>('[data-count]'); count.value = '65536'; count.dispatchEvent(new Event('change'))
    const distribution = find<HTMLSelectElement>('[data-distribution]'); distribution.value = start; distribution.dispatchEvent(new Event('change'))
    const force = find<HTMLSelectElement>('[data-force]'); force.value = 'four-corners'; force.dispatchEvent(new Event('change'))
    find<HTMLButtonElement>('[data-play]').click()
    await vi.waitFor(() => expect(find('[data-status]').textContent).toMatch(/tick [1-9]/), { timeout: 30000 })
    expect(find<HTMLButtonElement>('[data-play]').disabled).toBe(true)
    expect(force.disabled).toBe(true)
    find<HTMLButtonElement>('[data-pause]').click()
    expect(find('[data-status]').textContent).toContain('Paused')
    expect(find<HTMLButtonElement>('[data-play]').disabled).toBe(false)
    force.value = 'cell-center'; force.dispatchEvent(new Event('change'))
    expect(find('[data-status]').textContent).toContain('Ready')
    find<HTMLButtonElement>('[data-reset]').click()
    expect(find<HTMLButtonElement>('[data-play]').textContent).toBe('Run graph')
  } finally { view.destroy(); host.remove() }
}, 60000)
