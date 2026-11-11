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
import { compareSpringPrecision } from './spring-study'
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
    button('replay').click()
    await vi.waitFor(() => expect(button('step').disabled).toBe(false))
    expect(host.querySelector('[data-output="replay"]')!.textContent).toContain('Reproduced')
    button('export').click()
    const report = JSON.parse(await captured!.text())
    expect(report.replays.length).toBeGreaterThan(0); expect(report.captures.webgpu.tick).toBe(1)
    expect(report.rows).toHaveLength(1); expect(report.probe.alpha).toBe(1)
    expect(report.firstTickFailures.webgpu.tick).toBe(1)
    expect(Array.isArray(report.firstFailures['webgpu-outgoing'].input)).toBe(true)
    button('reset').click(); await vi.waitFor(() => expect(button('step').disabled).toBe(false))
    expect(button('export').disabled).toBe(true)
  } finally { app.destroy(); host.remove(); url.mockRestore(); click.mockRestore() }
})
it('checks first, interval and final ticks without treating unchecked ticks as passing', async () => {
  setup()
  const s = await createCombinedSession({ fixture: 'chain', count: 8, decay: 12, checkpointEvery: 5 }, () => document.createElement('canvas'))
  const read = vi.spyOn(s.lanes[0].backend, 'read'); const structure = vi.spyOn(s.lanes[0].backend, 'readStructure')
  try {
    for (let i = 0; i < 12; i++) await s.step()
    expect(s.rows.filter(r => r.checked).map(r => r.tick)).toEqual([1, 5, 10, 12])
    expect(read).toHaveBeenCalledTimes(4 * 4 + 8 * 2)
    expect(structure).toHaveBeenCalledTimes(4)
    for (const row of s.rows.filter(r => !r.checked)) {
      expect(row.complete).toBe(true)
      for (const r of row.results) {
        expect(r.stages).toEqual([]); expect(r.valid).toBeUndefined(); expect(r.wholeTick).toBeUndefined()
      }
    }
  } finally { read.mockRestore(); structure.mockRestore(); s.destroy() }
})
it('replays the original failing checkpoint without mutating trajectory, cooling or captures', async () => {
  setup()
  const s = await createCombinedSession({ fixture: 'chain', count: 8, decay: 12, checkpointEvery: 5 }, () => document.createElement('canvas'))
  try {
    for (let i = 0; i < 3; i++) await s.step()
    const original = JSON.stringify({ rows: s.rows, captures: s.captures, cpu: s.cpu(), alpha: s.alpha() })
    const positions = s.lanes.map(l => l.positions.slice())
    const reports = await s.replayFailures()
    expect(reports).toHaveLength(2)
    expect(reports.every(r => r.reproduced && r.restored && r.differingComponents === 0 && r.sameChecks)).toBe(true)
    expect(JSON.stringify({ rows: s.rows, captures: s.captures, cpu: s.cpu(), alpha: s.alpha() })).toBe(original)
    for (const [i, lane] of s.lanes.entries()) expect((await lane.backend.read()).positions).toEqual(positions[i])
    await s.step(true); expect(s.rows.at(-1)!.tick).toBe(4); expect(s.rows.at(-1)!.checked).toBe(true)
  } finally { s.destroy() }
})
it('reports a non-reproducing failure and restores state even if replay execution throws', async () => {
  setup()
  const s = await createCombinedSession({ fixture: 'chain', count: 8, decay: 12 }, () => document.createElement('canvas'))
  try {
    await s.step()
    const before = s.lanes.map(l => l.positions.slice())
    s.captures.webgl.actual[0] += 1
    const step = vi.spyOn(s.lanes[1].backend, 'stepStage').mockImplementationOnce(() => { throw new Error('Replay failed') })
    const reports = await s.replayFailures()
    expect(reports[0].reproduced).toBe(false); expect(reports[0].differingComponents).toBe(1)
    expect(reports[1].error).toContain('Replay failed'); expect(reports.every(r => r.restored)).toBe(true)
    for (const [i, lane] of s.lanes.entries()) expect((await lane.backend.read()).positions).toEqual(before[i])
    step.mockRestore()
  } finally { s.destroy() }
})
it('stops a path when replay cannot restore its original positions', async () => {
  setup()
  const s = await createCombinedSession({ fixture: 'chain', count: 8, decay: 12 }, () => document.createElement('canvas'))
  try {
    await s.step()
    const backend = s.lanes[1].backend; const set = backend.setPositions.bind(backend)
    const spy = vi.spyOn(backend, 'setPositions').mockImplementationOnce(set).mockImplementationOnce(() => { throw new Error('Restore failed') })
    const reports = await s.replayFailures()
    expect(reports[1].restored).toBe(false); expect(s.errors.webgpu).toContain('restore failed')
    spy.mockRestore()
    expect((await s.step()).complete).toBe(false)
  } finally { s.destroy() }
})

it('compares all spring modes on frozen captures without changing the live session', async () => {
  setup()
  const s = await createCombinedSession({ fixture: 'chain', count: 8, decay: 100 }, () => document.createElement('canvas'))
  try {
    await s.step()
    const points = s.lanes.map(l => l.positions.slice()); const cpu = s.cpu().slice(); const alpha = s.alpha()
    const history = JSON.stringify(s.rows); const captures = JSON.stringify(s.firstFailures)
    const rows = await compareSpringPrecision(s)
    expect(rows).toHaveLength(12)
    expect(rows.every(r => !r.error && r.forces && r.positions)).toBe(true)
    expect(vi.mocked(createCombinedWebGPU).mock.calls.slice(-6).map(call => call[3]))
      .toEqual(['baseline', 'force', 'integration', 'both', 'refined', 'distance'])
    expect(s.lanes.map(l => l.positions)).toEqual(points); expect(s.cpu()).toEqual(cpu)
    expect(s.alpha()).toBe(alpha); expect(JSON.stringify(s.rows)).toBe(history); expect(JSON.stringify(s.firstFailures)).toBe(captures)
    expect(destroyed).toBe(6)
    expect(await compareSpringPrecision(s, () => true)).toEqual([])
    expect(destroyed).toBe(6)
  } finally { s.destroy() }
  expect(destroyed).toBe(8)
})
it('records comparison setup errors without losing successful modes', async () => {
  setup()
  const s = await createCombinedSession({ fixture: 'chain', count: 8, decay: 100 }, () => document.createElement('canvas'))
  try {
    await s.step()
    vi.mocked(createCombinedWebGPU).mockRejectedValueOnce(new Error('Test precision pipeline failure'))
    const rows = await compareSpringPrecision(s)
    expect(rows).toHaveLength(12)
    expect(rows.filter(r => r.error)).toHaveLength(2)
    expect(rows.filter(r => r.error).every(r => r.mode === 'baseline')).toBe(true)
    expect(destroyed).toBe(5)
    expect(s.errors).toEqual({})
  } finally { s.destroy() }
})
