import { describe, expect, it } from 'vitest'
import { forceFrag } from '../../../../../src/modules/ForceLink/force-spring'
import { buildTopology, createFixture, PARAMETERS } from './data'
import { createSweepGraph, createSweepPlan, measureStages, runSweep, validateTrajectory, type SweepRow } from './sweep'
import { chooseOperations, gpuMedian, normalizeMeasurement, readLumaTimer, STAGES } from './timing'
import { compare, referenceTick } from './reference'
import { createWebGLBackend, springShader } from './webgl'
import { createWebGPUBackend } from './webgpu'
import type { LinkBackend, Measurement } from './backend'

describe('weighted-link measurement contracts', () => {
  it('keeps an exact production baseline and only removes the exhausted spring loop tail', () => {
    const original = forceFrag(99999)
    expect(springShader(99999, false)).toBe(original)
    expect(springShader(99999, true).replace('if (i >= linkAmount) break;\n      {', 'if (i < linkAmount) {')).toBe(original)
  })
  it('normalizes the entire batch and keeps invalid GPU samples unavailable', () => {
    const sample = normalizeMeasurement('tick', 4, 2, 8, 6, 'valid')
    expect(sample).toMatchObject({ operations: 4, submitMs: 0.5, completionMs: 2, gpuMs: 1.5, batchGpuMs: 6 })
    expect(normalizeMeasurement('force', 1, 0, 1, -1, 'valid').timerStatus).toBe('invalid')
    expect(normalizeMeasurement('force', 1, 0, 1, 3, 'disjoint').gpuMs).toBeNull()
    expect(gpuMedian([sample, { ...sample, gpuMs: null }])).toBeNull()
    expect(chooseOperations([sample])).toBe(4)
    expect(chooseOperations([{ ...sample, gpuMs: 0 }])).toBe(64)
    expect(() => normalizeMeasurement('tick', 0, 0, 0, 0, 'valid')).toThrow()
  })
  it('luma timers reject disjoint, invalid and unfinished results without fabricating zero', async () => {
    const query = (read: () => Promise<number>): Pick<import('@luma.gl/core').QuerySet, 'readTimestampDuration'> =>
      ({ readTimestampDuration: read })
    expect(await readLumaTimer(query(async () => 2.5))).toEqual({ milliseconds: 2.5, status: 'valid' })
    expect((await readLumaTimer(query(async () => NaN))).status).toBe('invalid')
    expect((await readLumaTimer(query(async () => { throw new Error('Disjoint GPU timer') }))).status).toBe('disjoint')
    let finish!: (value: number) => void
    const pending = new Promise<number>(resolve => { finish = resolve })
    const result = await readLumaTimer(query(() => pending), 1)
    finish(0) // luma destruction can resolve a pending read as zero; the timeout result must stay invalid.
    expect(result).toEqual({ milliseconds: null, status: 'timeout' })
    await expect(readLumaTimer(query(async () => { throw new Error('device lost') }))).rejects.toThrow('device lost')
  })
  it('uses equal point/link counts and deterministic positions/weights across the topology plan', () => {
    expect(createSweepPlan()).toHaveLength(16)
    expect(createSweepPlan(false)).toHaveLength(8)
    const shapes = createSweepPlan(false).slice(0, 4).map(item => createSweepGraph(item))
    for (const graph of shapes) {
      expect(graph.points).toEqual(shapes[0].points)
      expect(graph.weights).toEqual(shapes[0].weights)
      expect(graph.links.length).toBe(1998)
      expect(buildTopology(graph).links.length).toBe(1998)
    }
    expect(buildTopology(shapes[1]).maxDegree).toBe(999)
    expect(buildTopology(shapes[0]).maxDegree).toBe(2)
  })
  it('gates timing on correctness and retains the phase of a device failure', async () => {
    let measured = false
    const zero = new Float32Array(16)
    const backend = {
      name: 'fake',
      setGraph: () => ({ setupSubmitMs: 0, uploadCallMs: 0 }),
      synchronize: async () => {},
      reset: () => {},
      step: () => {},
      read: async () => ({ firstForce: zero, intermediate: zero, secondForce: zero, positions: zero }),
      measure: async () => { measured = true },
    } as unknown as LinkBackend
    const rows: SweepRow[] = []
    await runSweep([backend], [{ count: 4, shape: 'chain' }], () => false, () => {}, rows)
    expect(rows[0].status).toBe('failed'); expect(measured).toBe(false); expect(rows[0].timings).toHaveLength(0)
    backend.step = (): void => { throw new Error('WebGL context lost') }
    const failed: SweepRow[] = []
    await expect(runSweep([backend], [{ count: 4, shape: 'chain' }], () => false, () => {}, failed)).rejects.toThrow('context lost')
    expect(failed[0]).toMatchObject({ status: 'error', error: 'WebGL context lost', errorPhase: 'Validating fake · tick 1/25' })
  })
  it('does not start a later backend after cancellation during calibration', async () => {
    let cancelled = false; let calls = 0
    const backend = {
      name: 'fake',
      measure: async (): Promise<Measurement> => {
        calls++; cancelled = true; return normalizeMeasurement('force', 1, 0, 1, 1, 'valid')
      },
    } as unknown as LinkBackend
    const rows: never[] = []
    await measureStages([backend, backend], () => cancelled, () => {}, rows)
    expect(calls).toBe(1); expect(rows).toHaveLength(0)
  })
})

it('WebGL: early exit preserves ordered springs, absent neighbors and collision behavior', async () => {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
  let earlyExit = false
  const backend = await createWebGLBackend(canvas, () => earlyExit)
  try {
    for (const shape of ['star', 'hubs', 'edge-cases'] as const) {
      const graph = createFixture(shape, 129)
      const topology = buildTopology(graph)
      const params = { ...PARAMETERS, collision: true }
      earlyExit = false; backend.setGraph(graph, topology, params)
      const original = []
      for (let tick = 0; tick < 10; tick++) { backend.step(false); original.push(await backend.read()) }
      earlyExit = true; backend.setGraph(graph, topology, params)
      let cpu = graph.points
      for (let tick = 0; tick < 10; tick++) {
        const expected = referenceTick(graph, cpu, params); cpu = expected.positions
        backend.step(false)
        const actual = await backend.read()
        expect(compare(actual, original[tick]), `${shape} original tick ${tick}`).toMatchObject({ valid: true })
        expect(compare(actual, expected), `${shape} CPU tick ${tick}`).toMatchObject({ valid: true })
      }
    }
  } finally { backend.destroy() }
})

it.each([false, true])('WebGL: 100k star retains every neighbor over 25 ticks and timed stages (early exit: %s)', async earlyExit => {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
  const backend = await createWebGLBackend(canvas, () => earlyExit)
  try {
    const graph = createSweepGraph({ count: 100000, shape: 'star' })
    backend.setGraph(graph, buildTopology(graph), PARAMETERS)
    const expected = referenceTick(graph, graph.points, PARAMETERS)
    backend.step()
    expect(compare(await backend.read(), expected)).toMatchObject({ valid: true })
    const checks = await validateTrajectory([backend], graph, PARAMETERS, () => false, () => {})
    expect(checks).toHaveLength(3)
    expect(checks.every(check => check.valid)).toBe(true)
    for (const stage of STAGES) {
      await backend.measure(stage)
      expect(compare(await backend.read(true), expected), stage).toMatchObject({ valid: true })
    }
  } finally { backend.destroy() }
})

it('WebGL: 100k-star single and bounded draw calls produce identical nonempty images', async () => {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
  const backend = await createWebGLBackend(canvas)
  try {
    const graph = createSweepGraph({ count: 100000, shape: 'star' })
    backend.setGraph(graph, buildTopology(graph), PARAMETERS)
    const rows: import('./backend').RenderProbe[] = []
    await backend.diagnoseRender!(() => {}, rows, () => false)
    expect(rows).toHaveLength(6)
    expect(rows.every(row => row.matchesBounded && row.coloredPixels > 0)).toBe(true)
  } finally { backend.destroy() }
})

for (const [name, create] of [['WebGL', createWebGLBackend], ['WebGPU', createWebGPUBackend]] as const) {
  it(`${name}: batched stages keep input frozen and retain correct final outputs`, async context => {
    if (name === 'WebGPU' && !(await navigator.gpu?.requestAdapter())) {
      if (import.meta.env.REQUIRE_WEBGPU) throw new Error('WebGPU required')
      context.skip(); return
    }
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340; document.body.append(canvas)
    const backend = await create(canvas)
    try {
      const graph = createFixture('hubs', 129)
      const setup = backend.setGraph(graph, buildTopology(graph), PARAMETERS)
      expect(setup.setupSubmitMs).toBeGreaterThanOrEqual(setup.uploadCallMs)
      const expected = referenceTick(graph, graph.points, PARAMETERS)
      for (const stage of STAGES) {
        const sample = await backend.measure(stage, 7)
        expect(sample.operations).toBe(7)
        expect(sample.completionMs).toBeGreaterThanOrEqual(sample.submitMs)
        if (sample.gpuMs !== null) expect(sample.gpuMs * 7).toBeCloseTo(sample.batchGpuMs!, 9)
        expect(compare(await backend.read(true), expected), stage).toMatchObject({ valid: true })
        expect((await backend.read()).positions, `${stage} must not evolve the frozen starting state`).toEqual(graph.points)
      }
      backend.step()
      expect(compare(await backend.read(), expected)).toMatchObject({ valid: true })
    } finally { backend.destroy(); canvas.remove() }
  })
}

for (const [name, create] of [['WebGL', createWebGLBackend], ['WebGPU', createWebGPUBackend]] as const) {
  it(`${name}: isolated pass readbacks validate every output before the next pass`, async () => {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
    const backend = await create(canvas, () => true)
    try {
      const graph = createSweepGraph({ count: 100000, shape: 'star' })
      backend.setGraph(graph, buildTopology(graph), PARAMETERS)
      await backend.synchronize()
      const expected = referenceTick(graph, graph.points, PARAMETERS)
      const { SIMULATION_PASSES } = await import('./backend')
      const { compareArray } = await import('./reference')
      for (const pass of SIMULATION_PASSES) {
        const actual = await backend.diagnosePass!(pass)
        expect(compareArray(actual, expected[pass]), pass).toMatchObject({ valid: true })
      }
      expect(compare(await backend.read(), expected)).toMatchObject({ valid: true })
    } finally { backend.destroy() }
  })
}

it('WebGL: fence synchronization preserves the complete 100k-star trajectory', async () => {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
  const checkpoints: import('./backend').WebGLCheckpoint[] = []
  const backend = await createWebGLBackend(canvas, () => true, () => 'fence', entry => checkpoints.push(entry))
  try {
    const graph = createSweepGraph({ count: 100000, shape: 'star' })
    backend.setGraph(graph, buildTopology(graph), PARAMETERS)
    await backend.synchronize()
    const checks = await validateTrajectory([backend], graph, PARAMETERS, () => false, () => {})
    expect(checks.map(check => check.tick)).toEqual([1, 10, 25])
    expect(checks.every(check => check.valid)).toBe(true)
    expect(checkpoints.every(entry => !entry.contextLost)).toBe(true)
    const phases = checkpoints.map(entry => entry.phase)
    expect(phases.filter(phase => phase === 'after completion wait (fence)')).toHaveLength(26)
    expect(phases.filter(phase => phase === 'after snapshot readback event-loop yield')).toHaveLength(3)
    const firstRead = phases.indexOf('before full snapshot readback')
    expect(phases.slice(firstRead, firstRead + 10)).toEqual([
      'before full snapshot readback',
      'before source force readPixels', 'after source force readPixels',
      'before source positions readPixels', 'after source positions readPixels',
      'before target force readPixels', 'after target force readPixels',
      'before final positions readPixels', 'after final positions readPixels',
      'after snapshot readback event-loop yield',
    ])
  } finally { backend.destroy() }
})

it('fences yield before polling, reject failure/timeout/context loss, and always release the sync', async () => {
  const { waitForWebGLFence } = await import('./timing')
  let deleted = 0; let polls = 0; let flushed = false
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    ALREADY_SIGNALED: 2,
    CONDITION_SATISFIED: 3,
    WAIT_FAILED: 4,
    TIMEOUT_EXPIRED: 5,
    fenceSync: () => ({}),
    flush: () => { flushed = true },
    isContextLost: () => false,
    clientWaitSync: (_sync: unknown, flags: number, timeout: number) => {
      expect(flushed).toBe(true); expect(flags).toBe(0); expect(timeout).toBe(0); polls++; return polls < 2 ? 5 : 3
    },
    deleteSync: () => { deleted++ },
  } as unknown as WebGL2RenderingContext
  const pending = waitForWebGLFence(gl)
  expect(polls).toBe(0)
  await pending; expect(polls).toBe(2); expect(deleted).toBe(1)
  gl.clientWaitSync = (): number => 4
  await expect(waitForWebGLFence(gl)).rejects.toThrow('wait failed')
  gl.clientWaitSync = (): number => 5
  await expect(waitForWebGLFence(gl, -1)).rejects.toThrow('timeout')
  gl.flush = (): void => { gl.isContextLost = (): boolean => true }
  await expect(waitForWebGLFence(gl)).rejects.toThrow('context lost')
  expect(deleted).toBe(4)
})

it('retains completed trajectory snapshots when a later tick loses its device', async () => {
  const graph = createSweepGraph({ count: 4, shape: 'star' })
  const expected = referenceTick(graph, graph.points, PARAMETERS)
  let tick = 0
  const backend = {
    name: 'fake',
    reset: () => {},
    step: () => { tick++ },
    synchronize: async () => { if (tick === 2) throw new Error('device lost') },
    read: async () => expected,
  } as unknown as LinkBackend
  const checks: import('./sweep').ValidationCheck[] = []
  await expect(validateTrajectory([backend], graph, PARAMETERS, () => false, () => {}, undefined, checks)).rejects.toThrow('device lost')
  expect(checks).toEqual([{ tick: 1, backend: 'fake', valid: true, failures: 0, maxError: 0 }])
})
