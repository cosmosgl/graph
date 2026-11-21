import { expect, it } from 'vitest'
import { createGridAggregationView } from './view'

it('offers a small starting comparison while preserving the grid acceptance case', async () => {
  for (const [acceptance, points] of [[false, '4096'], [true, '8192']] as const) {
    const host = document.createElement('div'); document.body.append(host)
    const view = await createGridAggregationView(host, acceptance)
    try {
      expect(host.querySelector<HTMLSelectElement>('[data-control="count"]')!.value).toBe(points)
      expect(host.querySelector('[data-action="compare"]')?.closest('.run-primary-actions')).not.toBeNull()
      expect(host.querySelector('#run-more-settings [data-control="candidate"]')).not.toBeNull()
      expect(host.querySelector('#run-diagnostics > h2')?.textContent).toBe('Diagnostics')
      expect(host.querySelector('details')).toBeNull()
    } finally { view.destroy(); host.remove() }
  }
})
