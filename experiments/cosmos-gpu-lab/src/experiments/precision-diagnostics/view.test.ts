import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ExperimentInstance } from '../../runtime/experiment'
import { nativeDiagnostics, productionGravity } from './gpu'
import { createPrecisionView } from './view'

vi.mock('./gpu', () => ({ nativeDiagnostics: vi.fn(), productionGravity: vi.fn() }))

let host: HTMLElement
let view: ExperimentInstance
beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div'); document.body.append(host)
})
afterEach(() => { view?.destroy(); host.remove() })

it('runs only addition on the selected default input and clears results when the input changes', async () => {
  vi.mocked(nativeDiagnostics).mockResolvedValue({
    device: 'Test WebGPU',
    adapter: {},
    gravity: [],
    sums: [{ name: 'WGSL serial', value: 1 }, { name: 'WGSL blocked 64', value: 16 }, { name: 'WGSL tree 256', value: 512 }],
  })
  view = createPrecisionView(host, 'addition-order')
  expect(host.querySelector<HTMLSelectElement>('[data-records]')!.value).toBe('1024')
  expect(host.querySelector('[data-input-description]')!.textContent).toContain('the exact sum is 512')
  host.querySelector<HTMLButtonElement>('[data-run]')!.click()
  await vi.waitFor(() => expect(host.querySelector('[data-status]')!.textContent).toBe('1 of 3 WebGPU methods reached the exact sum of 512.'))
  expect(productionGravity).not.toHaveBeenCalled()
  const [points, values, path] = vi.mocked(nativeDiagnostics).mock.calls[0]
  expect(points).toHaveLength(0); expect(values).toHaveLength(1024); expect(path).toBe('addition')
  expect(host.querySelector('[data-results]')!.textContent).toContain('WebGPU · tree of 256 partial sums')
  expect(host.querySelector('[data-run-summary-value="passed"]')!.textContent).toBe('No pass threshold')
  const input = host.querySelector<HTMLSelectElement>('[data-fixture]')!
  input.value = 'positive'; input.dispatchEvent(new Event('input', { bubbles: true }))
  expect(host.querySelector('[data-results]')!.textContent).toBe('')
  expect(host.querySelector('[data-input-description]')!.textContent).toContain('the exact sum is 2,560')
  expect(host.querySelector<HTMLButtonElement>('[data-export]')!.disabled).toBe(true)
})

it('runs only gravity and clears an unavailable GPU result on a successful retry', async () => {
  vi.mocked(productionGravity).mockImplementation(async points => ({ forces: new Float32Array(points.length), device: 'Test WebGL' }))
  vi.mocked(nativeDiagnostics).mockRejectedValueOnce(new Error('GPU unavailable')).mockImplementation(async points => ({
    device: 'Test WebGPU', adapter: {}, sums: [], gravity: [{ name: 'WGSL Cartesian', forces: new Float32Array(points.length) }],
  }))
  view = createPrecisionView(host, 'gravity-accuracy')
  expect(host.querySelector<HTMLSelectElement>('[data-records]')!.value).toBe('257')
  expect(host.querySelector('[data-fixture]')).toBeNull()
  const run = host.querySelector<HTMLButtonElement>('[data-run]')!
  run.click()
  await vi.waitFor(() => expect(host.querySelector('[data-status]')!.textContent).toContain('Partial comparison'))
  expect(host.querySelector('[data-results]')!.textContent).toContain('WebGPU unavailable')
  run.click()
  await vi.waitFor(() => expect(host.querySelector('[data-status]')!.textContent).toContain('of 2 GPU paths matched the legacy model within tolerance'))
  const [points, values, path] = vi.mocked(nativeDiagnostics).mock.calls[1]
  expect(points).toHaveLength(257 * 4); expect(values).toHaveLength(0); expect(path).toBe('gravity')
  expect(host.querySelector('[data-results]')!.textContent).toContain('WGSL Cartesian')
  expect(host.querySelector('[data-results]')!.textContent).not.toContain('unavailable')
  expect(host.querySelector('[data-run-summary-value="state"]')!.textContent).toBe('Complete')
})
