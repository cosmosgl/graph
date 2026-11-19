import { expect, it } from 'vitest'
import { describeEnvironment } from '../../gpu/force-preview'
import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { createGraph, stagesFor, type Stage } from '../combined-layout/data'
import { forceSettings, type ForceSettings } from '../combined-layout/production-settings'
import { createOracle } from '../combined-layout/reference'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import { fitView } from '../many-body/backend'
import { compareArray, type Snapshot } from '../many-body/reference'
import { median } from '../many-body/timing'
import type { BackendContext } from '../many-body/webgpu'
import { COLLISION, COLLISION_EXACT_LIMIT } from './data'
import { HASHED_COLLISION_LIMIT } from './hashed-grid'

const COUNT = HASHED_COLLISION_LIMIT
const TICK = 11
const ALPHA = 0.64
const COLLISION_SETTINGS = { ...COLLISION, cooling: 0.5, iterations: 2 }
const SETTINGS: ForceSettings = {
  ...forceSettings('reference', COUNT),
  center: 0.1,
  origin: [127.5, -63.25],
  collision: COLLISION_SETTINGS,
  hashedCollision: true,
}

function graphFixture (count = COUNT): ReturnType<typeof createGraph> {
  const fixture = createGraph({ fixture: 'communities', count, decay: 40 })
  fixture.input.points[2] = 1
  fixture.input.points[7] = 1
  for (let i = 0; i < count; i++) fixture.graph.sizes[i] = 2 + i % 5
  return fixture
}

function targetCanvas (): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 340
  document.body.append(canvas)
  return canvas
}

function createCandidate (
  target: HTMLCanvasElement, fixture: ReturnType<typeof graphFixture>, settings = SETTINGS, context?: BackendContext
): ReturnType<typeof createCombinedWebGPU> {
  return createCombinedWebGPU(target, fixture.graph, fixture.input, 'trig', {
    forceSettings: settings, gpuBounds: true, repulsionPolicy: 'production', springOptimization: 'hoist', context,
  })
}

function expectedFrame (
  oracle: ReturnType<typeof createOracle>, input: Float32Array, stages: readonly Stage[], alpha: number, tick: number
): Snapshot {
  let result: Snapshot = { positions: input, forces: new Float32Array(input.length) }
  let iteration = 0
  for (const stage of stages) result = oracle.stage(stage, result.positions, alpha, tick, stage === 'collision' ? iteration++ : 0)
  return result
}

function movementCheck (actual: Float32Array, expected: Float32Array, initial: Float32Array): ReturnType<typeof compareArray> & {
  fixed: boolean; witness: { index: number; actual: number; expected: number } | null;
} {
  const check = compareArray(actual, expected, initial)
  let fixed = true
  for (let i = 0; i < initial.length; i += 4) {
    if (initial[i + 2] <= 0.5 && initial[i + 3] <= 0.5) continue
    if (!Object.is(actual[i], initial[i]) || !Object.is(actual[i + 1], initial[i + 1])) fixed = false
  }
  const i = check.worstIndex
  return { ...check, fixed, witness: check.valid || i < 0 ? null : { index: i, actual: actual[i], expected: expected[i] } }
}

it('rebuilds the hashed collision grid for each normal tick iteration and keeps the exact fallback', async () => {
  const target = targetCanvas()
  const ledger = new BufferLedger()
  const device = await createDevice('webgpu', target, true)
  const context = { device, ledger }
  const fixture = graphFixture()
  const { graph, input } = fixture
  const coreStages = stagesFor(SETTINGS.center)
  const oracle = createOracle(graph, input, 'production', SETTINGS)
  const view = fitView([input.points])
  let backend: Awaited<ReturnType<typeof createCandidate>> | undefined
  const checks: Array<{
    name: string; positions: ReturnType<typeof movementCheck>; forces?: ReturnType<typeof compareArray>;
  }> = []
  try {
    backend = await createCandidate(target, fixture, SETTINGS, context)
    const activeBytes = ledger.liveBytes
    const identity = backend.resourceIdentity!()
    let expected = input.points
    for (const [offset, alpha] of [ALPHA, 0.5, 0.36].entries()) {
      const tick = TICK + offset
      backend.stepTick!(alpha, tick)
      const actual = await backend.read()
      expected = oracle.tick(expected, alpha, tick)
      checks.push({ name: `normal tick ${tick}`, positions: movementCheck(actual.positions, expected, input.points) })
    }

    backend.setPositions(input.points)
    const { snapshot: prefix } = await backend.measureCurrentFrame!(ALPHA, TICK, view, coreStages)
    const expectedPrefix = expectedFrame(oracle, input.points, coreStages, ALPHA, TICK)
    checks.push({ name: 'normal tick prefix', positions: movementCheck(prefix.positions, expectedPrefix.positions, input.points) })
    backend.setPositions(prefix.positions)
    const expectedFull = expectedFrame(oracle, prefix.positions, ['collision', 'collision'], ALPHA, TICK)
    const { snapshot: collisionOnly } = await backend.measureCurrentFrame!(ALPHA, TICK, view, ['collision', 'collision'])
    checks.push({
      name: 'two collision passes on normal prefix',
      positions: movementCheck(collisionOnly.positions, expectedFull.positions, input.points),
      forces: compareArray(collisionOnly.forces, expectedFull.forces),
    })
    expect(compareArray(collisionOnly.positions, prefix.positions).valid).toBe(false)

    // Dense membership spans a cell boundary. The second pass must use a
    // new seed and the positions produced by the first pass in one submission.
    const dense = input.points.slice()
    const [x, y] = SETTINGS.origin!
    for (let i = 50; i < 160; i++) {
      dense.set([x + 22.875 + (i % 13) * 0.15625, y + 22.75 + (i % 17) * 0.125], i * 4)
    }
    const first = oracle.stage('collision', dense, ALPHA, TICK, 0)
    const second = oracle.stage('collision', first.positions, ALPHA, TICK, 1)
    const repeatedSeed = oracle.stage('collision', first.positions, ALPHA, TICK, 0)
    expect(compareArray(first.positions, dense).valid).toBe(false)
    expect(compareArray(second.forces, repeatedSeed.forces).valid).toBe(false)
    backend.setPositions(dense)
    const { snapshot: denseResult } = await backend.measureCurrentFrame!(ALPHA, TICK, fitView([dense]), ['collision', 'collision'])
    checks.push({
      name: 'two dense collision passes',
      positions: movementCheck(denseResult.positions, second.positions, dense),
      forces: compareArray(denseResult.forces, second.forces),
    })

    const small = graphFixture(COLLISION_EXACT_LIMIT)
    backend.resizeGraph!(small.graph, small.input, false)
    backend.setGpuFrame!(TICK)
    backend.stepStage('collision', ALPHA)
    const exact = createOracle(small.graph, small.input, 'production', SETTINGS).stage('collision', small.input.points, ALPHA, TICK)
    const exactResult = await backend.read()
    checks.push({
      name: 'exact fallback at 4,096',
      positions: movementCheck(exactResult.positions, exact.positions, small.input.points),
      forces: compareArray(exactResult.forces, exact.forces),
    })

    backend.resizeGraph!(graph, input, false)
    expect(backend.resourceIdentity!()).toEqual(identity)
    const replacement = { ...graph, sizes: graph.sizes.map(size => size + 4) }
    backend.replaceLinks!(replacement)
    backend.setGpuFrame!(TICK)
    backend.stepStage('collision', ALPHA)
    const regrown = await backend.read()
    const newOracle = createOracle(replacement, input, 'production', SETTINGS)
    const replacementResult = newOracle.stage('collision', input.points, ALPHA, TICK)
    checks.push({
      name: 'hashed regrowth with replaced radii',
      positions: movementCheck(regrown.positions, replacementResult.positions, input.points),
      forces: compareArray(regrown.forces, replacementResult.forces),
    })
    backend.destroy()
    expect(ledger.liveBytes).toBe(0)

    const zero = { ...SETTINGS, collision: { ...COLLISION_SETTINGS, strength: 0 } }
    backend = await createCandidate(target, fixture, zero, context)
    const zeroBytes = ledger.liveBytes
    const zeroOracle = createOracle(graph, input, 'production', zero)
    backend.stepTick!(ALPHA, TICK)
    const zeroResult = await backend.read()
    const zeroExpected = expectedFrame(zeroOracle, input.points, coreStages, ALPHA, TICK)
    checks.push({
      name: 'zero-strength normal tick',
      positions: movementCheck(zeroResult.positions, zeroExpected.positions, input.points),
      forces: compareArray(zeroResult.forces, zeroExpected.forces),
    })
    backend.destroy()
    expect(ledger.liveBytes).toBe(0)
    backend = await createCandidate(target, fixture, { ...SETTINGS, collision: undefined }, context)
    expect(ledger.liveBytes).toBe(zeroBytes)
    expect(activeBytes).toBeGreaterThan(zeroBytes)
    await writeArtifact('collision-hashed-composition', {
      environment: describeEnvironment(device, target),
      count: COUNT,
      activeBytes,
      zeroBytes,
      settings: SETTINGS,
      checks,
      source: import.meta.env.LAB_SOURCE_REVISION,
      snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    })
    const failed = checks.filter(check => !check.positions.valid || !check.positions.fixed || check.forces?.valid === false)
    expect(failed, JSON.stringify(failed)).toEqual([])
  } finally { backend?.destroy(); device.destroy(); target.remove() }
}, 120000)

it.skipIf(import.meta.env.VITE_LAB_HASHED_COLLISION_COST !== '1')('measures both hashed passes in a normal GPU tick at 8,192 points', async () => {
  const fixture = graphFixture()
  const { graph, input } = fixture
  const target = targetCanvas()
  let backend: Awaited<ReturnType<typeof createCandidate>> | undefined
  const rows = []
  const view = fitView([input.points])
  const oracle = createOracle(graph, input, 'production', SETTINGS)
  // Both lanes retain the same contact-radius floor in their spring passes.
  const stages = [stagesFor(SETTINGS.center), stagesFor(SETTINGS.center, SETTINGS.collision)]
  const expected = stages.map(order => expectedFrame(oracle, input.points, order, ALPHA, TICK))
  try {
    expect(import.meta.env.LAB_RUN_ID && import.meta.env.LAB_SOURCE_REVISION && import.meta.env.LAB_SOURCE_SNAPSHOT).toBeTruthy()
    if (navigator.userAgent.includes('HeadlessChrome')) throw new Error('Use visible native Chrome')
    backend = await createCandidate(target, fixture)
    const device = backend.positionSource!().device
    const environment = describeEnvironment(device, target)
    expect(environment.device.fallback).toBe(false)
    for (let pair = 0; pair < 9; pair++) {
      for (const lane of pair % 2 ? [1, 0] : [0, 1]) {
        if (!describeEnvironment(device, target).visible) throw new Error('Timing page became hidden')
        backend.setPositions(input.points)
        const sample = await backend.measureFrozenFrames!({ frames: 4, alpha: ALPHA, tick: TICK, view, stages: stages[lane] })
        const checks = sample.snapshots.map(frame => movementCheck(frame.positions, expected[lane].positions, input.points))
        rows.push({ pair, lane, warmup: pair < 2, timing: sample.timing, gpuTimes: sample.frameGpuMs, checks })
      }
    }
    const samples = rows.filter(row => !row.warmup)
    const complete = samples.every(row => row.timing.timerStatus === 'valid' && row.gpuTimes.every(time => time !== null))
    const laneMs = (lane: number): number | null => complete
      ? median(samples.filter(row => row.lane === lane).flatMap(row => row.gpuTimes as number[]))
      : null
    const pairedDeltaMs = complete
      ? median(Array.from({ length: 7 }, (_, i) => {
        const base = samples.find(row => row.pair === i + 2 && row.lane === 0)!.gpuTimes as number[]
        const hashed = samples.find(row => row.pair === i + 2 && row.lane === 1)!.gpuTimes as number[]
        return median(hashed) - median(base)
      }))
      : null
    await writeArtifact('collision-hashed-tick-cost', {
      environment,
      count: COUNT,
      alpha: ALPHA,
      tick: TICK,
      settings: SETTINGS,
      stages,
      rows,
      summarisedGpuMs: { withoutPasses: laneMs(0), withPasses: laneMs(1), pairedDeltaMs },
      source: import.meta.env.LAB_SOURCE_REVISION,
      snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    })
    expect(rows.every(row => row.checks.every(check => check.valid && check.fixed))).toBe(true)
    expect(complete).toBe(true)
  } finally { backend?.destroy(); target.remove() }
}, 360000)
