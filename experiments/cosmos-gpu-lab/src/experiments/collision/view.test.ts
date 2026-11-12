import { afterEach, expect, it, vi } from 'vitest'
import { TOLERANCE, compareArray } from '../many-body/reference'
import { TOLERANCE as springTolerance } from '../weighted-links/reference'
import { createFixture } from './data'
import { createCollisionSession, type CollisionSession } from './session'
import { createCollisionView } from './view'

vi.mock('./session', () => ({ createCollisionSession: vi.fn() }))

let host: HTMLElement | undefined
let instance: Awaited<ReturnType<typeof createCollisionView>> | undefined
afterEach(() => { instance?.destroy(); host?.remove(); vi.clearAllMocks() })

it('highlights trajectory-only failures, retains them after a passing tick and clears them on reset', async () => {
  vi.mocked(createCollisionSession).mockImplementation(async settings => {
    const input = createFixture(settings.fixture, settings.count, settings.topology)
    const points = input.input.points
    const report: CollisionSession['report'] = {
      schemaVersion: 2,
      recordedAt: new Date().toISOString(),
      browser: navigator.userAgent,
      settings,
      tolerance: TOLERANCE,
      springTolerance,
      rows: [],
      errors: {},
      devices: {},
      input,
      failures: {},
      trajectoryFailures: {},
      stressSampling: { landmarks: [], pairs: 0, unreachable: 0 },
      replays: [],
    }
    return {
      settings,
      graph: input.graph,
      lanes: [],
      report,
      cpu: (): Float32Array => points,
      alpha: (): number => settings.alpha,
      async step (): Promise<void> {
        // Local comparisons pass from each lane's own input, while the first
        // independent WebGPU snapshot has accumulated a coordinate difference.
        const actual = points.slice()
        if (settings.evolution === 'independent' && !report.rows.length) actual[0] += 1
        const local = compareArray(points, points, points)
        const trajectory = compareArray(actual, points, points)
        if (!trajectory.valid) {
          report.trajectoryFailures.webgpu = { tick: 1, alpha: settings.alpha, input: points, actual, expected: points }
        }
        report.rows.push({
          tick: report.rows.length + 1,
          alpha: settings.alpha,
          complete: true,
          checks: { webgl: { stages: [], whole: local, valid: true }, webgpu: { stages: [], whole: local, valid: true } },
          trajectory: { webgl: local, webgpu: trajectory },
          cross: trajectory,
          metrics: {},
          overlap: {},
        })
      },
      async replay (): Promise<void> {},
      destroy: vi.fn(),
    }
  })
  host = document.createElement('div'); document.body.append(host)
  instance = await createCollisionView(host)
  const button = (action: string): HTMLButtonElement => host!.querySelector(`[data-action="${action}"]`)!
  const badge = (api: string): HTMLElement => host!.querySelector(`[data-state="${api}"]`)!
  const evolution = host.querySelector<HTMLSelectElement>('[data-control="evolution"]')!
  evolution.value = 'independent'; evolution.dispatchEvent(new Event('change'))
  await vi.waitFor(() => expect(button('step').disabled).toBe(false))
  button('step').click()
  await vi.waitFor(() => {
    expect(button('step').disabled).toBe(false)
    expect(host!.querySelector('[data-output="tick"]')!.textContent).toBe('1')
  })
  expect(badge('webgpu').textContent).toBe('1/1 tick checks')
  expect(badge('webgpu').classList.contains('failed')).toBe(true)
  expect(badge('webgl').classList.contains('failed')).toBe(false)
  expect(badge('cpu').classList.contains('failed')).toBe(false)
  await vi.waitFor(() => expect(host!.querySelector('[data-run-summary-value="failed"]')!.textContent)
    .toBe('1 failed tick and trajectory gates'))

  button('step').click()
  await vi.waitFor(() => {
    expect(button('step').disabled).toBe(false)
    expect(host!.querySelector('[data-output="tick"]')!.textContent).toBe('2')
  })
  expect(badge('webgpu').textContent).toBe('2/2 tick checks')
  expect(badge('webgpu').classList.contains('failed')).toBe(true)
  button('reset').click()
  await vi.waitFor(() => {
    expect(button('step').disabled).toBe(false)
    expect(badge('webgpu').textContent).toBe('Ready · no checks yet')
  })
  expect(badge('webgpu').classList.contains('failed')).toBe(false)
  await vi.waitFor(() => expect(host!.querySelector('[data-run-summary-value="failed"]')!.textContent).toBe('None recorded'))
})
