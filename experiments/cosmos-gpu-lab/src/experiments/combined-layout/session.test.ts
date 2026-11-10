import { afterEach, expect, it, vi } from 'vitest'
import type { Snapshot } from '../many-body/reference'
import { buildReference, frameFor } from '../many-body-grid/data'
import { centroidReference } from '../many-body-grid/centroids'
import { createCombinedWebGL } from './webgl'
import { createCombinedWebGPU } from './webgpu'
import { createCombinedSession } from './session'
import { createOracle } from './reference'
import { createCombinedView } from './view'
import { cool } from './data'
vi.mock('./webgl', () => ({ createCombinedWebGL: vi.fn() }))
vi.mock('./webgpu', () => ({ createCombinedWebGPU: vi.fn() }))
let destroyed = 0
function setup (missing = false): void {
  const make: typeof createCombinedWebGPU = async (_canvas, graph, input) => {
    let points = input.points; let frame = frameFor(points, 0)
    let structure = buildReference(points, frame)
    let snapshot: Snapshot = { positions: points, forces: new Float32Array(points.length) }
    const oracle = createOracle(graph, input)
    return {
      name: 'test',
      info: 'test',
      setPositions (next): void { points = next; snapshot = { ...snapshot, positions: next } },
      setFrame (next): void { frame = next },
      stepStage (stage, alpha): void {
        structure = buildReference(points, frame)
        snapshot = oracle.stage(stage, points, alpha, 0)
        if (stage === 'outgoing') snapshot.positions[0] += 0.1
        points = snapshot.positions
      },
      read: async () => snapshot,
      readStructure: async () => structure,
      readCentroids: async () => centroidReference(structure),
      step (): never { throw new Error('Use stage API') },
      measure: async (): Promise<never> => { throw new Error('Not timed') },
      render (): void {},
      destroy (): void { destroyed++ },
    }
  }
  vi.mocked(createCombinedWebGL).mockImplementation(make)
  vi.mocked(createCombinedWebGPU).mockImplementation(missing ? async (): Promise<never> => { throw new Error('Test device unavailable') } : make)
}
afterEach(() => { vi.clearAllMocks(); destroyed = 0 })
it('retains stage and full-tick failures, and a probe leaves cooling, positions and history unchanged', async () => {
  setup(); const s = await createCombinedSession({ fixture: 'chain', count: 8, decay: 100 }, () => document.createElement('canvas'))
  try {
    await s.step()
    expect(s.rows[0].results.every(r => !r.valid)).toBe(true)
    expect(s.firstFailures['webgpu-outgoing'].tick).toBe(1)
    expect(s.firstTickFailures.webgpu.tick).toBe(1)
    const points = s.lanes.map(l => l.positions.slice()); const alpha = s.alpha()
    const probe = await s.probe()
    expect(probe.results.every(r => !r.valid)).toBe(true)
    expect(s.rows).toHaveLength(1); expect(s.alpha()).toBe(alpha)
    expect(s.lanes.map(l => l.positions)).toEqual(points)
    await s.step(); expect(s.rows[1].alpha).toBe(cool(1, 100))
    expect(s.firstTickFailures.webgpu.tick).toBe(1)
  } finally { s.destroy() }
  expect(destroyed).toBe(2)
})
it('never reports a missing backend as a complete comparison or probe', async () => {
  setup(true); const s = await createCombinedSession({ fixture: 'pinned', count: 8, decay: 100 }, () => document.createElement('canvas'))
  try {
    expect((await s.step()).complete).toBe(false)
    expect((await s.probe()).complete).toBe(false)
    expect(s.errors.webgpu).toContain('unavailable')
  } finally { s.destroy() }
  expect(destroyed).toBe(1)
})
it('exports a cancelled partial run and probe without losing failure evidence', async () => {
  setup()
  const host = document.createElement('div'); document.body.append(host)
  const app = await createCombinedView(host)
  const button = (action: string): HTMLButtonElement => host.querySelector(`[data-action="${action}"]`)!
  let captured: Blob | undefined
  const url = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob as Blob; return 'blob:test' })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    button('run').click(); button('stop').click()
    await vi.waitFor(() => expect(button('step').disabled).toBe(false))
    expect(host.querySelector('[data-output="tick"]')!.textContent).toBe('1')
    button('probe').click()
    await vi.waitFor(() => expect(button('step').disabled).toBe(false))
    expect(host.querySelector('[data-output="tick"]')!.textContent).toBe('1')
    button('export').click()
    const report = JSON.parse(await captured!.text())
    expect(report.rows).toHaveLength(1); expect(report.probe.alpha).toBe(1)
    expect(report.firstTickFailures.webgpu.tick).toBe(1)
    expect(Array.isArray(report.firstFailures['webgpu-outgoing'].input)).toBe(true)
    button('reset').click(); await vi.waitFor(() => expect(button('step').disabled).toBe(false))
    expect(button('export').disabled).toBe(true)
  } finally { app.destroy(); host.remove(); url.mockRestore(); click.mockRestore() }
})
