import { expect, it } from 'vitest'
import { createGridAggregationView } from './view'

it('offers a small starting comparison while preserving the grid acceptance case', async () => {
  for (const [acceptance, points] of [[false, '4096'], [true, '8192']] as const) {
    const host = document.createElement('div'); document.body.append(host)
    const view = await createGridAggregationView(host, acceptance)
    try {
      expect(host.querySelector<HTMLSelectElement>('[data-control="count"]')!.value).toBe(points)
      expect(host.querySelector('[data-action="compare"]')?.closest('.run-primary-actions')).not.toBeNull()
      expect(host.querySelector('[data-control="candidate"]')?.closest('details')?.querySelector('summary')?.textContent).toBe('More settings')
      expect(host.querySelector('#run-diagnostics details > summary')?.textContent).toBe('Additional checks')
    } finally { view.destroy(); host.remove() }
  }
})
