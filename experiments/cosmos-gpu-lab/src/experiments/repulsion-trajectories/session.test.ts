import { afterEach, expect, it, vi } from 'vitest'
import type { Snapshot } from '../many-body/reference'
import { createGridWebGL } from '../many-body-grid/webgl'
import { createGridWebGPU } from '../many-body-grid/webgpu'
import { buildReference } from '../many-body-grid/data'
import { gridReference } from '../many-body-grid/reference'
import { centroidReference } from '../many-body-grid/centroids'
import type { GridBackend } from '../many-body-grid/backend'
import { createTrajectorySession } from './session'
vi.mock('../many-body-grid/webgl', () => ({ createGridWebGL: vi.fn() }))
vi.mock('../many-body-grid/webgpu', () => ({ createGridWebGPU: vi.fn() }))
const seen: Float32Array[] = []; const destroyed = vi.fn()
function setup (missing = false): void {
  const make: typeof createGridWebGPU = async (_canvas, input, p, initial, mode) => {
    if (missing && mode === 'materialized') throw new Error('Test adapter missing')
    let points = input.points; let frame = initial; let structure = buildReference(points, frame)
    let snapshot: Snapshot = { positions: points, forces: new Float32Array(points.length) }
    return {
      name: mode ?? 'webgl',
      info: 'test',
      setPositions (): never { throw new Error('Independent paths must not reset positions') },
      setFrame (next): void { frame = next },
      step (): void {
        if (mode === 'streamed') seen.push(points.slice())
        structure = buildReference(points, frame)
        snapshot = gridReference(input, points, p, frame, structure)
        if (mode === 'streamed') snapshot.positions[0] += 1
        points = snapshot.positions
      },
      read: async () => snapshot,
      readStructure: async () => structure,
      readCentroids: async () => centroidReference(structure),
      measure: async (): Promise<never> => { throw new Error('Not timed') },
      render (): void {},
      destroy: destroyed,
    } satisfies GridBackend
  }
  vi.mocked(createGridWebGL).mockImplementation((canvas, input, p, frame) => make(canvas, input, p, frame))
  vi.mocked(createGridWebGPU).mockImplementation(make)
}
afterEach(() => { vi.clearAllMocks(); seen.length = 0 })
it('advances resident paths, checks each own input and retains the first failure without excusing it as drift', async () => {
  setup(); const s = await createTrajectorySession({ fixture: 'uniform', count: 8, slots: 2, precise: true }, () => document.createElement('canvas'))
  try {
    const first = await s.step(); const own = s.lanes.find(l => l.name === 'streamed')!.positions.slice()
    const second = await s.step()
    expect(seen[1]).toEqual(own)
    expect(seen[1]).not.toEqual(s.firstFailures.streamed!.expected.positions)
    expect(first.checks.find(c => c.name === 'streamed')!.valid).toBe(false)
    expect(second.checks.find(c => c.name === 'streamed')!.valid).toBe(false)
    expect(second.checks.find(c => c.name === 'materialized')!.valid).toBe(true)
    expect(second.correctedDrift!.max).toBeGreaterThan(0)
    expect(s.firstFailures.streamed!.tick).toBe(1)
    expect(second.complete).toBe(true) // Complete is availability, not a correctness verdict.
  } finally { s.destroy() }
  expect(destroyed).toHaveBeenCalledTimes(3)
})
it('never treats a missing backend as a complete comparison and releases available devices', async () => {
  setup(true); const s = await createTrajectorySession({ fixture: 'edge-cases', count: 512, slots: 2, precise: false }, () => document.createElement('canvas'))
  try {
    const row = await s.step()
    expect(s.settings.count).toBe(8)
    expect(row.complete).toBe(false); expect(row.correctedDrift).toBeNull()
    expect(row.errors.materialized).toContain('missing')
  } finally { s.destroy() }
  expect(destroyed).toHaveBeenCalledTimes(2)
})

it('keeps partial run failures visible, exports their arrays, and resets the history', async () => {
  setup()
  const { createTrajectories } = await import('./view')
  const host = document.createElement('div'); document.body.append(host)
  const app = await createTrajectories(host)
  const button = (action: string): HTMLButtonElement => host.querySelector(`[data-action="${action}"]`)!
  let captured: Blob | undefined
  const url = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob as Blob; return 'blob:test' })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    button('run').click(); button('stop').click()
    await vi.waitFor(() => expect(button('run').disabled).toBe(false))
    expect(host.querySelector('[data-output="tick"]')!.textContent).toBe('1')
    expect(host.querySelector('[data-output="status"]')!.textContent).toContain('Local-check failures')
    button('export').click()
    const report = JSON.parse(await captured!.text())
    expect(report.rows).toHaveLength(1)
    expect(report.firstFailures.streamed.tick).toBe(1)
    expect(Array.isArray(report.firstFailures.streamed.input)).toBe(true)
    expect(report.rows[0].checks.find((c: { name: string }) => c.name === 'streamed').valid).toBe(false)
    button('reset').click()
    await vi.waitFor(() => expect(button('run').disabled).toBe(false))
    expect(host.querySelector('[data-output="tick"]')!.textContent).toBe('0')
    expect(button('export').disabled).toBe(true)
  } finally { app.destroy(); host.remove(); url.mockRestore(); click.mockRestore() }
})
