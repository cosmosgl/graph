import { expect, it } from 'vitest'
import { describeEnvironment } from '../../gpu/force-preview'
import { writeArtifact } from '../../testing/artifacts'
import { changedMembership } from '../cluster-attraction/study'
import { fitView } from '../many-body/backend'
import { compareArray, type Snapshot } from '../many-body/reference'
import { sharedView } from '../matched-layout/metrics'
import { percentile } from '../million-graph/field-metrics'
import { mouseReference } from '../mouse-repulsion/reference'
import { changedTargets } from '../point-attractors/data'
import { cool, REPULSION } from './data'
import { compositionFixture, createCompositionOracle } from './force-composition'
import { createOracle } from './reference'
import { createCombinedWebGPU, type MouseForce, type AdditionalForces, type ExtendedCombinedBackend } from './webgpu'

type Fixture = ReturnType<typeof compositionFixture>
type CompositionState = {
  oracle: ReturnType<typeof createCompositionOracle>;
  cluster: Fixture['cluster'];
  attractor: Fixture['attractor'];
  inputPositions: Float32Array;
  normal: Snapshot;
  pointer?: MouseForce;
  alpha: number;
  tick: number;
}

function canvas (): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 340
  document.body.append(canvas)
  return canvas
}

function createCandidate (canvas: HTMLCanvasElement, fixture: Fixture, extra: boolean): ReturnType<typeof createCombinedWebGPU> {
  const { graph, input, settings, cluster, attractor } = fixture
  const additionalForces: AdditionalForces | undefined = extra ? { mouse: true, cluster, attractor } : undefined
  return createCombinedWebGPU(canvas, graph, input, 'trig', {
    forceSettings: settings,
    gpuBounds: true,
    repulsionPolicy: 'production',
    springOptimization: 'hoist',
    additionalForces,
  })
}

function fixedState (points: Float32Array, initial: Float32Array): boolean {
  for (let i = 0; i < points.length; i += 4) {
    if (points[i + 2] !== initial[i + 2] || points[i + 3] !== initial[i + 3]) return false
    if (!Number.isFinite(points[i]) || !Number.isFinite(points[i + 1])) return false
    if ((initial[i + 2] || initial[i + 3]) && (points[i] !== initial[i] || points[i + 1] !== initial[i + 1])) return false
  }
  return true
}

function screenMotion (
  actual: Float32Array, expected: Float32Array, previousGpu: Float32Array, previousCpu: Float32Array,
  { width, height }: HTMLCanvasElement
): { positionP95Px: number; positionMaxPx: number; motionP95Px: number; motionMaxPx: number } {
  const [, , scaleX, scaleY] = sharedView([expected])
  const xPx = width * scaleX / 2
  const yPx = height * scaleY / 2
  const position: number[] = []
  const motion: number[] = []
  for (let i = 0; i < expected.length; i += 4) {
    if (expected[i + 3] > 0.5) continue
    const dx = actual[i] - expected[i]
    const dy = actual[i + 1] - expected[i + 1]
    const previousDx = previousGpu[i] - previousCpu[i]
    const previousDy = previousGpu[i + 1] - previousCpu[i + 1]
    position.push(Math.hypot(dx * xPx, dy * yPx))
    motion.push(Math.hypot((dx - previousDx) * xPx, (dy - previousDy) * yPx))
  }
  return {
    positionP95Px: percentile(position, 0.95),
    positionMaxPx: Math.max(...position),
    motionP95Px: percentile(motion, 0.95),
    motionMaxPx: Math.max(...motion),
  }
}

async function diagnose (backend: ExtendedCombinedBackend, state: CompositionState): Promise<{
  stages: Array<{ stage: string; positions: ReturnType<typeof compareArray>; forces: ReturnType<typeof compareArray> }>;
  stagedAgainstNormal: ReturnType<typeof compareArray>;
}> {
  const { oracle, inputPositions, normal, pointer, cluster, attractor, alpha, tick } = state
  backend.replaceClusters!(cluster)
  backend.replaceAttractors!(attractor)
  backend.setMouseRepulsion!(pointer)
  backend.setPositions(inputPositions)
  backend.setGpuFrame!(tick)
  let actual = { positions: inputPositions, forces: normal.forces }
  const stages = []
  for (const stage of oracle.order(pointer, attractor)) {
    const expected = oracle.stage(stage, actual.positions, alpha, tick, pointer, attractor)
    if (stage === 'mouse' || stage === 'cluster' || stage === 'attractor') backend.stepAdditionalForce!(stage, alpha)
    else backend.stepStage(stage, alpha)
    actual = await backend.read()
    stages.push({ stage, forces: compareArray(actual.forces, expected.forces), positions: compareArray(actual.positions, expected.positions) })
  }
  return { stages, stagedAgainstNormal: compareArray(actual.positions, normal.positions) }
}

const specimens = [
  { count: 256, ticks: 16, collision: true, screen: false },
  { count: 8192, ticks: 8, collision: false, screen: false },
  { count: 256, ticks: 40, collision: true, screen: true },
  { count: 8192, ticks: 40, collision: false, screen: true },
]
for (const spec of specimens) {
  const question = spec.screen ? 'screens local layout motion for' : 'compares resident production-order forces on'
  it.skipIf(!import.meta.env.LAB_COMPOSED_FORCE_TIMING)(`${question} ${spec.count} communities`, async () => {
    const fixture = compositionFixture(spec.count, spec.collision)
    const { input } = fixture
    const target = canvas()
    const backend = await createCandidate(target, fixture, true)
    let oracle = createCompositionOracle(fixture)
    const rows = []
    try {
      if (spec.screen) {
        const environment = describeEnvironment(backend.positionSource!().device, target)
        expect(environment.visible && !navigator.userAgent.includes('HeadlessChrome') && environment.device.fallback === false).toBe(true)
      }
      const held: MouseForce = { world: [11, -17], strength: 2 }
      backend.setMouseRepulsion!(held)
      expect(backend.stepAdditionalForce!('mouse', 1)).toBe(true)
      const pausedExpected = mouseReference(input.points, held.world, held.strength, REPULSION)
      const paused = await backend.read()
      const pauseCheck = compareArray(paused.positions, pausedExpected.positions, input.points)
      backend.setMouseRepulsion!()
      expect(backend.stepAdditionalForce!('mouse', 1)).toBe(false)
      const released = await backend.read()
      expect(released.positions).toEqual(paused.positions)
      backend.setPositions(input.points)
      let expected = input.points
      let previousGpu = input.points
      let alpha = 1
      let cluster = fixture.cluster
      let attractor = fixture.attractor
      let firstFailure: CompositionState | undefined
      for (let tick = 0; tick < spec.ticks; tick++) {
        const pointer = tick < 2 ? held : undefined
        backend.setMouseRepulsion!(pointer)
        if (tick === 2) attractor = { ...attractor, targets: undefined }
        if (tick === 4) attractor = changedTargets(fixture.attractor)
        if (tick === 2 || tick === 4) backend.replaceAttractors!(attractor)
        if (tick === 6) {
          cluster = changedMembership(fixture.cluster)
          backend.replaceClusters!(cluster)
          oracle = createCompositionOracle({ ...fixture, cluster })
        }
        const sequence = oracle.order(pointer, attractor)
        const previousCpu = expected
        let snapshot: Snapshot = { positions: expected, forces: new Float32Array(expected.length) }
        for (const stage of sequence) snapshot = oracle.stage(stage, snapshot.positions, alpha, tick, pointer, attractor)
        expected = snapshot.positions
        backend.stepTick!(alpha, tick)
        const actual = await backend.read()
        const positions = compareArray(actual.positions, expected, input.points)
        const forces = compareArray(actual.forces, snapshot.forces)
        if (!spec.screen && !firstFailure && (!positions.valid || !forces.valid)) {
          firstFailure = { oracle, cluster, attractor, inputPositions: previousGpu, normal: actual, pointer, alpha, tick }
        }
        const screen = spec.screen ? screenMotion(actual.positions, expected, previousGpu, previousCpu, target) : undefined
        rows.push({ tick, sequence, alpha, positions, forces, screen, fixed: fixedState(actual.positions, input.points) })
        previousGpu = actual.positions
        alpha = pointer ? Math.max(cool(alpha, 40), 0.1) : cool(alpha, 40)
      }
      const diagnostic = firstFailure ? await diagnose(backend, firstFailure) : undefined
      if (import.meta.env.LAB_RUN_ID) {
        await writeArtifact(`composed-${spec.screen ? 'layout-motion' : 'forces'}-${spec.count}`, {
          spec,
          pauseCheck,
          rows,
          diagnostic,
          environment: describeEnvironment(backend.positionSource!().device, target),
          source: import.meta.env.LAB_SOURCE_REVISION,
          snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
        })
      }
      expect(pauseCheck.valid, JSON.stringify(pauseCheck)).toBe(true)
      const failures = spec.screen
        ? rows.filter(row => !row.fixed || !(row.screen!.positionMaxPx <= 1 && row.screen!.motionMaxPx <= 1))
        : rows.filter(row => !row.fixed || !row.positions.valid || !row.forces.valid)
      expect(failures, JSON.stringify(failures.slice(0, 3))).toEqual([])
    } finally { backend.destroy(); target.remove() }
  }, 240000)
}

it.skipIf(!import.meta.env.LAB_COMPOSED_FORCE_TIMING)('compares the resident GPU cost of base and expanded forces', async () => {
  const count = 8192
  const fixture = compositionFixture(count, false)
  const target = canvas()
  const expandedCanvas = canvas()
  const candidates: ExtendedCombinedBackend[] = []
  const rows = []
  const view = fitView([fixture.input.points])
  const pointer: MouseForce = { world: [11, -17], strength: 2 }
  const { graph, settings, input, attractor } = fixture
  const baseline = createOracle(graph, input, 'production', settings).tick(input.points, 1, 0)
  const oracle = createCompositionOracle(fixture)
  const expected = oracle.order(pointer, attractor).reduce(
    (points, stage) => oracle.stage(stage, points, 1, 0, pointer, attractor).positions, input.points
  )
  try {
    expect(import.meta.env.LAB_RUN_ID && import.meta.env.LAB_SOURCE_REVISION && import.meta.env.LAB_SOURCE_SNAPSHOT).toBeTruthy()
    if (document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) throw new Error('Use visible native Chrome')
    // These canvases and devices are prepared before warmup. Each gets the same frozen input.
    candidates.push(await createCandidate(target, fixture, false))
    candidates.push(await createCandidate(expandedCanvas, fixture, true))
    candidates[1].setMouseRepulsion!(pointer)
    const environment = describeEnvironment(candidates[0].positionSource!().device, target)
    expect(environment.device.fallback).toBe(false)
    for (let pair = 0; pair < 9; pair++) {
      for (const lane of pair % 2 ? [1, 0] : [0, 1]) {
        if (!describeEnvironment(candidates[lane].positionSource!().device, target).visible) throw new Error('Timing page became hidden')
        candidates[lane].setPositions(input.points)
        const frames = await candidates[lane].measureFrozenFrames!({ frames: 4, alpha: 1, tick: 0, view })
        const checks = frames.snapshots.map(s => ({
          ...compareArray(s.positions, lane ? expected : baseline, input.points),
          fixed: fixedState(s.positions, input.points),
        }))
        rows.push({ pair, lane, warmup: pair < 2, timing: frames.timing, gpuTimes: frames.frameGpuMs, checks })
      }
    }
    await writeArtifact('composed-force-timing', {
      environment, count, rows, source: import.meta.env.LAB_SOURCE_REVISION, snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    })
    expect(rows.every(row => row.checks.every(check => check.valid && check.fixed))).toBe(true)
  } finally { for (const backend of candidates) backend.destroy(); expandedCanvas.remove(); target.remove() }
}, 360000)
