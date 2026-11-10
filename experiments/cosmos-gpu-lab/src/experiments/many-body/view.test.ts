import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebGL } from './webgl'
import { createWebGPU } from './webgpu'
import { createManyBodyExperiment } from './view'
import { referenceTick, type Snapshot } from './reference'
import type { Backend } from './backend'
import type { Input, Parameters } from './data'
vi.mock('./webgl', () => ({ createWebGL: vi.fn() }))
vi.mock('./webgpu', () => ({ createWebGPU: vi.fn() }))

let host: HTMLDivElement | undefined
let instance: { destroy(): void } | undefined
function fake (input: Input, p: Parameters, bad = false): Backend {
  let current = input.points
  let snapshot: Snapshot = { forces: new Float32Array(current.length), positions: current }
  return {
    name: 'test backend',
    info: 'test backend',
    setPositions (positions): void { current = positions },
    step (): void {
      snapshot = referenceTick(input, current, p)
      if (bad) snapshot.forces[0] += 1
      current = snapshot.positions
    },
    async read (): Promise<Snapshot> { return snapshot },
    async measure (): Promise<never> { throw new Error('Not used in this UI test') },
    render (): void {},
    destroy: vi.fn(),
  }
}
async function mount (unavailable = false, bad = false): Promise<HTMLDivElement> {
  vi.mocked(createWebGL).mockImplementation(async (_canvas, input, p) => fake(input, p))
  vi.mocked(createWebGPU).mockImplementation(async (_canvas, input, p) => {
    if (unavailable) throw new Error('No test adapter')
    return fake(input, p, bad)
  })
  host = document.createElement('div'); document.body.append(host)
  instance = await createManyBodyExperiment(host)
  return host
}
async function step (page: HTMLElement): Promise<void> {
  page.querySelector<HTMLButtonElement>('[data-action="step"]')!.click()
  await vi.waitFor(() => expect(page.querySelector<HTMLButtonElement>('[data-action="step"]')!.disabled).toBe(false))
}
afterEach(() => { instance?.destroy(); host?.remove(); vi.clearAllMocks() })

describe('many-body comparison UI verdicts', () => {
  it('keeps CPU / available WebGL usable but never calls a missing WebGPU comparison a pass', async () => {
    const page = await mount(true)
    await step(page)
    expect(page.querySelector('[data-output="status"]')?.textContent).toContain('Partial comparison')
    expect(page.querySelector('[data-status="WebGPU"]')?.textContent).toBe('Unavailable')
    expect(page.querySelector('[data-output="results"]')?.textContent).toContain('WebGL vs CPU')
    expect(page.querySelector<HTMLButtonElement>('[data-action="export"]')?.disabled).toBe(false)
  })
  it('does not relabel an incorrect one-step force as harmless trajectory drift', async () => {
    const page = await mount(false, true)
    const mode = page.querySelector<HTMLSelectElement>('[data-control="mode"]')!
    mode.value = 'trajectory'; mode.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(page.querySelector<HTMLButtonElement>('[data-action="step"]')!.disabled).toBe(false))
    await step(page)
    expect(page.querySelector('[data-output="status"]')?.textContent).toContain('Mismatch')
    expect(page.querySelector('[data-status="WebGPU"]')?.textContent).toBe('Mismatch')
    expect(page.querySelector('[data-output="results"]')?.textContent).toContain('Fail (1 components)')
    expect(page.querySelector('[data-output="results"]')?.textContent).toContain('Drift only')
  })
})
