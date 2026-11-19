import { expect, it } from 'vitest'
import { createPerformanceLab } from './view'

it('opens each performance case with its own workload and a small starting input', async () => {
  for (const [caseId, workload, points] of [
    ['circle-rendering', 'rendering', '10000'],
    ['center-reduction', 'simulation', '8192'],
  ]) {
    const host = document.createElement('div'); document.body.append(host)
    const view = await createPerformanceLab(host, caseId)
    try {
      const selector = host.querySelector<HTMLSelectElement>('[data-control="workload"]')!
      expect(selector.value).toBe(workload)
      expect(selector.closest('label')?.hidden).toBe(true)
      expect(host.querySelector<HTMLSelectElement>('[data-control="count"]')!.value).toBe(points)
      expect(host.querySelector<HTMLButtonElement>('.run-primary-actions [data-action="run"]')?.disabled).toBe(false)
    } finally { view.destroy(); host.remove() }
  }
})
