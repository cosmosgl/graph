import { afterEach, expect, it, vi } from 'vitest'
import type { Snapshot } from '../many-body/reference'
import type { Input, Parameters } from '../many-body/data'
import { createGridWebGL } from './webgl'
import { createGridWebGPU } from './webgpu'
import { createGridExperiment } from './view'
import { buildReference, type Frame, type Structure } from './data'
import { gridReference } from './reference'
import type { GridBackend } from './backend'
vi.mock('./webgl', () => ({ createGridWebGL: vi.fn() }))
vi.mock('./webgpu', () => ({ createGridWebGPU: vi.fn() }))
let host: HTMLDivElement | undefined
let instance: { destroy(): void } | undefined
function fake (input: Input, p: Parameters, initial: Frame, bad: boolean, renderFailure: boolean): GridBackend {
  let points = input.points; let frame = initial
  let stepped = false
  let structure = buildReference(points, frame)
  let snapshot: Snapshot = { positions: points, forces: new Float32Array(points.length) }
  return {
    name: 'test backend',
    info: 'test backend',
    setPositions (next): void { points = next },
    setFrame (next): void { frame = next },
    step (): void {
      stepped = true; structure = buildReference(points, frame)
      snapshot = gridReference(input, points, p, frame, structure)
      if (bad) snapshot.forces[0] += 1
    },
    async read (): Promise<Snapshot> { return snapshot },
    async readStructure (): Promise<Structure> { return structure },
    async measure (): Promise<never> { throw new Error('Not a timing test') },
    render (): void { if (stepped && renderFailure) throw new Error('Test context lost') },
    destroy: vi.fn(),
  }
}
async function ready (page: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(page.querySelector<HTMLButtonElement>('[data-action="step"]')!.disabled).toBe(false))
}
async function mount (options: { missing?: boolean; badBoth?: boolean; renderFailure?: boolean } = {}): Promise<HTMLDivElement> {
  vi.mocked(createGridWebGL).mockImplementation(async (_canvas, input, p, frame) => fake(input, p, frame, Boolean(options.badBoth), false))
  vi.mocked(createGridWebGPU).mockImplementation(async (_canvas, input, p, frame) => {
    if (options.missing) throw new Error('No test adapter')
    return fake(input, p, frame, Boolean(options.badBoth), Boolean(options.renderFailure))
  })
  host = document.createElement('div'); document.body.append(host)
  instance = await createGridExperiment(host)
  const fixture = host.querySelector<HTMLSelectElement>('[data-control="fixture"]')!
  fixture.value = 'edge-cases'; fixture.dispatchEvent(new Event('change'))
  await ready(host)
  return host
}
async function step (page: HTMLElement): Promise<void> {
  page.querySelector<HTMLButtonElement>('[data-action="step"]')!.click(); await ready(page)
}
afterEach(() => { instance?.destroy(); host?.remove(); vi.clearAllMocks() })
it('shows the actual fixed fixture count and never passes a missing backend', async () => {
  const page = await mount({ missing: true }); await step(page)
  expect(page.querySelector<HTMLSelectElement>('[data-control="count"]')!.value).toBe('8')
  expect(page.querySelector('[data-output="status"]')!.textContent).toContain('Partial comparison')
  expect(page.querySelector('[data-status="WebGPU"]')!.textContent).toBe('Unavailable')
  expect(page.querySelector('[data-output="results"]')!.textContent).toContain('WebGL')
})
it('does not let GPU agreement hide a shared CPU-reference mismatch', async () => {
  const page = await mount({ badBoth: true }); await step(page)
  expect(page.querySelector('[data-output="status"]')!.textContent).toContain('Mismatch')
  expect(page.querySelector('[data-output="results"]')!.textContent).toContain('WebGPU vs production WebGL: forces Pass')
  expect(page.querySelector('[data-status="WebGL"]')!.textContent).toBe('Mismatch')
  expect(page.querySelector('[data-status="WebGPU"]')!.textContent).toBe('Mismatch')
})
it('retains the other panels and export after a rendering failure', async () => {
  const page = await mount({ renderFailure: true }); await step(page)
  expect(page.querySelector('[data-status="WebGPU"]')!.textContent).toBe('Failed')
  expect(page.querySelector('[data-info="WebGPU"]')!.textContent).toContain('Test context lost')
  expect(page.querySelector('[data-output="status"]')!.textContent).not.toMatch(/^Passed/)
  expect(page.querySelector<HTMLButtonElement>('[data-action="export"]')!.disabled).toBe(false)
})
