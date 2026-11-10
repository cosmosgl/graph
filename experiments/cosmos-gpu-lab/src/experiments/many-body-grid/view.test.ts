import { afterEach, expect, it, vi } from 'vitest'
import type { Snapshot } from '../many-body/reference'
import type { Input, Parameters } from '../many-body/data'
import { compareCentroidPass } from './centroid-comparison'
import { createTrace, type Trace } from './trace'
import { createGridWebGL } from './webgl'
import { createGridWebGPU } from './webgpu'
import { createGridExperiment } from './view'
import { buildReference, type Frame, type Structure } from './data'
import { gridReference } from './reference'
import type { GridBackend } from './backend'
vi.mock('./centroid-comparison', () => ({ compareCentroidPass: vi.fn() }))
vi.mock('./webgl', () => ({ createGridWebGL: vi.fn() }))
vi.mock('./webgpu', () => ({ createGridWebGPU: vi.fn() }))
let host: HTMLDivElement | undefined
let instance: { destroy(): void } | undefined
function fake (input: Input, p: Parameters, initial: Frame, bad: boolean, renderFailure: boolean, badReplay = false): GridBackend {
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
    async diagnose (): Promise<{ trace: Trace; forces: Float32Array }> {
      const trace = createTrace(points.length / 4)
      const replay = gridReference(input, points, p, frame, structure, trace)
      if (badReplay) replay.forces[0] += 10
      return { trace, forces: replay.forces }
    },
    async measure (): Promise<never> { throw new Error('Not a timing test') },
    render (): void { if (stepped && renderFailure) throw new Error('Test context lost') },
    destroy: vi.fn(),
  }
}
async function ready (page: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(page.querySelector<HTMLButtonElement>('[data-action="step"]')!.disabled).toBe(false))
}
async function mount (options: { missing?: boolean; badBoth?: boolean; renderFailure?: boolean; badReplay?: boolean } = {}): Promise<HTMLDivElement> {
  vi.mocked(createGridWebGL).mockImplementation(async (_canvas, input, p, frame) => fake(input, p, frame, Boolean(options.badBoth), false))
  vi.mocked(createGridWebGPU).mockImplementation(async (_canvas, input, p, frame) => {
    if (options.missing) throw new Error('No test adapter')
    return fake(input, p, frame, Boolean(options.badBoth), Boolean(options.renderFailure), Boolean(options.badReplay))
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

it('shows a useful precision trace and keeps the original verdict', async () => {
  const page = await mount()
  page.querySelector<HTMLButtonElement>('[data-action="trace"]')!.click(); await ready(page)
  expect(page.querySelector('[data-output="status"]')!.textContent).toMatch(/^Passed/)
  expect(page.querySelector('[data-output="trace"]')!.textContent).toContain('near clamped')
  expect(page.querySelector('[data-output="trace"]')!.textContent).toContain('do not replace the baseline')
})
it('does not trust an instrumented replay that changes the normal force', async () => {
  const page = await mount({ badReplay: true })
  page.querySelector<HTMLButtonElement>('[data-action="trace"]')!.click(); await ready(page)
  expect(page.querySelector('[data-output="status"]')!.textContent).toContain('Mismatch')
  expect(page.querySelector('[data-status="WebGPU"]')!.textContent).toBe('Mismatch')
  expect(page.querySelector('[data-output="trace"]')!.textContent).toContain('trace is not representative')
})

it('exports diagnostic summaries with the normal verdict, without raw trace arrays', async () => {
  const page = await mount()
  page.querySelector<HTMLButtonElement>('[data-action="trace"]')!.click(); await ready(page)
  let captured: Blob | undefined
  const url = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob as Blob; return 'blob:test' })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    page.querySelector<HTMLButtonElement>('[data-action="export"]')!.click()
    const result = JSON.parse(await captured!.text())
    expect(result.rows[0].passed).toBe(true)
    expect(result.rows[0].diagnostics).toHaveLength(2)
    const report = result.rows[0].diagnostics[0].report
    expect(report.replay.valid).toBe(true)
    expect(report.hypotheses).toHaveLength(3)
    expect(report.target.stages.length).toBeGreaterThan(3)
    expect(report.trace).toBeUndefined()
  } finally { url.mockRestore(); click.mockRestore() }
})

it('keeps a failed centroid variant distinct from a passing inline baseline and exports both verdicts', async () => {
  const check = { valid: true, failures: 0, maxError: 0, worstIndex: -1 }
  const output = { forces: check, positions: check, valid: true }
  const candidate = {
    inline: output,
    stored: { ...output, valid: false, forces: { ...check, valid: false, failures: 2, maxError: 0.001 } },
    sameCentroids: output,
    structural: { valid: true, aggregates: check, slotMismatches: 0, maxHashError: 0 },
    replay: output,
    versusInline: output,
    centroids: { differingComponents: 1, maxUlp: 1, maxError: 0.0001 },
    centroidCheck: check,
    stages: [],
    storedPassed: false,
    extraStorageBytes: 1024,
    extraDispatches: 1,
    device: 'test device',
  }
  vi.mocked(compareCentroidPass).mockResolvedValue({
    ...candidate,
    corrected: {
      ...candidate,
      centroids: { differingComponents: 0, maxUlp: 0, maxError: 0 },
      division: { cases: 131080, mismatches: 0, firstFailure: null },
    },
  })
  const page = await mount()
  page.querySelector<HTMLButtonElement>('[data-action="centroids"]')!.click(); await ready(page)
  expect(page.querySelector('[data-output="status"]')!.textContent).toContain('Inline baseline: Passed')
  expect(page.querySelector('[data-output="status"]')!.textContent).toContain('Stored centroid variant: Mismatch')
  let captured: Blob | undefined
  const url = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob as Blob; return 'blob:test' })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    page.querySelector<HTMLButtonElement>('[data-action="export"]')!.click()
    const row = JSON.parse(await captured!.text()).rows[0]
    expect(row.passed).toBe(true)
    expect(row.centroidComparison.storedPassed).toBe(false)
    expect(row.centroidComparison.stored.forces.failures).toBe(2)
    expect(row.centroidComparison.corrected.centroids.differingComponents).toBe(0)
    expect(row.centroidComparison.corrected.storedPassed).toBe(false)
  } finally { url.mockRestore(); click.mockRestore() }
})
