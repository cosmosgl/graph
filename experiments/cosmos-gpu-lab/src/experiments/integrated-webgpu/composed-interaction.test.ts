import { expect, it, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { describeEnvironment } from '../../gpu/force-preview'
import { waitForGpu } from '../../gpu/luma'
import { writeArtifact } from '../../testing/artifacts'
import { changedMembership } from '../cluster-attraction/study'
import { createCompositionOracle } from '../combined-layout/force-composition'
import { createSamplingPolicy } from '../combined-layout/production-settings'
import { ALL_PAIRS_MAX_POINTS } from '../combined-layout/repulsion-policy'
import { stageDurations } from '../combined-layout/stage-timing'
import { buildReference, cellOf, frameFor, layout } from '../many-body-grid/data'
import { compareArray, type Snapshot } from '../many-body/reference'
import { motionChecks, percentile } from '../million-graph/field-metrics'
import { changedTargets } from '../point-attractors/data'
import { displacement } from '../repulsion-trajectories/metrics'
import { readLumaTimer, type TimerStatus } from '../weighted-links/timing'
import { createIntegrated, nextFrame, type Integrated, type IntegratedForceStep } from './runtime'
import { measureQuality } from './quality'
import { fit } from './validation'

type ScreenPoint = [number, number]
type BrowserBounds = { bounds: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number } }
declare module 'vitest/browser' {
  interface BrowserCommands {
    composedInput(action: 'layout'): Promise<BrowserBounds>;
    composedInput(action: 'left-down' | 'right-down' | 'move' | 'zoom-deep' | 'pick', from: ScreenPoint): Promise<void>;
    composedInput(action: 'left-up' | 'right-up'): Promise<void>;
  }
}

const width = 961
const height = 541
const ratio = 2
const cooling = 200
const frames = 64
const screenLimit = 1
const frameTarget = 33
const pickTarget = 50
const nativeStudy = import.meta.env.VITE_LAB_COMPOSED_INTERACTION === '1'
const requestedScale = import.meta.env.VITE_LAB_COMPOSED_SCALE
const scaleStudy = requestedScale === '1' || requestedScale === '32768'
const scaleCount = requestedScale === '32768' ? 32768 : 16384
const mouseArithmetic = import.meta.env.VITE_LAB_MOUSE_ARITHMETIC === 'native' ? 'native' : 'expanded'
const layouts = scaleStudy
  ? [
    { kind: 'communities', count: 8192, forces: 'composed-collision' },
    { kind: 'communities', count: scaleCount, forces: 'composed-collision' },
    { kind: 'hubs', count: scaleCount, forces: 'composed-collision' },
  ] as const
  : [
    { kind: 'karate', count: 34, forces: 'composed-collision' },
    { kind: 'communities', count: 256, forces: 'composed-collision' },
    { kind: 'chain', count: 8192, forces: 'composed' },
    { kind: 'star', count: 8192, forces: 'composed' },
    { kind: 'communities', count: 8192, forces: 'composed-collision' },
  ] as const

type Fixture = NonNullable<Integrated['composition']>
type Witness = {
  step: Omit<IntegratedForceStep, 'composition'>;
  composition: Fixture;
  previousGpu: Float32Array;
  previousCpu: Float32Array;
  normal: Snapshot;
}

function createCanvas (): { host: HTMLDivElement; canvas: HTMLCanvasElement } {
  const host = document.createElement('div')
  host.dataset.composedStudy = ''
  const canvas = document.createElement('canvas')
  canvas.width = width * ratio
  canvas.height = height * ratio
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  host.append(canvas)
  document.body.append(host)
  return { host, canvas }
}

function projectedError (
  actual: Float32Array, cpu: Float32Array, previousGpu: Float32Array, previousCpu: Float32Array, scale: number, previousScale: number
): { positionPx: number; motionPx: number } {
  let positionPx = 0
  let motionPx = 0
  for (let i = 0; i < actual.length; i += 4) {
    if (cpu[i + 3] > 0.5) continue
    const dx = (actual[i] - cpu[i]) * scale
    const dy = (actual[i + 1] - cpu[i + 1]) * scale
    const beforeX = (previousGpu[i] - previousCpu[i]) * previousScale
    const beforeY = (previousGpu[i + 1] - previousCpu[i + 1]) * previousScale
    positionPx = Math.max(positionPx, Math.hypot(dx, dy))
    motionPx = Math.max(motionPx, Math.hypot(dx - beforeX, dy - beforeY))
  }
  return { positionPx, motionPx }
}

function stages (oracle: ReturnType<typeof createCompositionOracle>, fixture: Fixture, step: IntegratedForceStep):
Array<{ name: ReturnType<typeof oracle.order>[number]; iteration: number }> {
  if (step.kind === 'mouse') return [{ name: 'mouse', iteration: 0 }]
  let collisionIteration = 0
  return oracle.order(step.mouse, fixture.attractor).map(name => ({ name, iteration: name === 'collision' ? collisionIteration++ : 0 }))
}

function compareGrid (gpu: Float32Array, cpu: Float32Array, { step, composition }: Witness, target: number): {
  changedCells: number; changedSlotIds: number; gpuCell: number; cpuCell: number; gpuNearIds: number[]; cpuNearIds: number[];
} {
  const { samples, precise } = composition.settings
  const gpuFrame = frameFor(gpu, step.tick, samples, precise)
  const cpuFrame = frameFor(cpu, step.tick, samples, precise)
  const gpuGrid = buildReference(gpu, gpuFrame)
  const cpuGrid = buildReference(cpu, cpuFrame)
  const { finest } = layout(gpu.length / 4)
  const cells = finest ** 2
  let changedCells = 0
  for (let i = 0; i < gpu.length; i += 4) {
    if (gpu[i + 3] > 0.5) continue
    if (cellOf(gpu[i], gpu[i + 1], finest, gpuFrame.bounds) !== cellOf(cpu[i], cpu[i + 1], finest, cpuFrame.bounds)) changedCells++
  }
  let changedSlotIds = 0
  for (let i = 0; i < gpuGrid.slots.length; i += 2) {
    if (gpuGrid.slots[i] !== cpuGrid.slots[i]) changedSlotIds++
  }
  const gpuCell = cellOf(gpu[target * 4], gpu[target * 4 + 1], finest, gpuFrame.bounds)
  const cpuCell = cellOf(cpu[target * 4], cpu[target * 4 + 1], finest, cpuFrame.bounds)
  const nearby = (cell: number, slots: Float32Array): number[] => {
    const cx = cell % finest; const cy = Math.floor(cell / finest)
    const ids: number[] = []
    for (let y = Math.max(0, cy - 1); y <= Math.min(finest - 1, cy + 1); y++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(finest - 1, cx + 1); x++) {
        for (let slot = 0; slot < samples; slot++) {
          const id = slots[(slot * cells + y * finest + x) * 2]
          if (id < 0) break
          if (id !== target) ids.push(id)
        }
      }
    }
    return ids
  }
  return {
    changedCells,
    changedSlotIds,
    gpuCell,
    cpuCell,
    gpuNearIds: nearby(gpuCell, gpuGrid.slots),
    cpuNearIds: nearby(cpuCell, cpuGrid.slots),
  }
}

async function replayWitness (backend: Integrated['backend'], witness: Witness): Promise<{
  stages: Array<{
    name: string; position: ReturnType<typeof compareArray>; force: ReturnType<typeof compareArray>;
    independent: ReturnType<typeof compareArray>; grid?: ReturnType<typeof compareGrid>;
  }>;
  stagedAgainstNormal: ReturnType<typeof compareArray>;
}> {
  const { step, composition, previousGpu, previousCpu, normal } = witness
  const { cluster: { membership, strengths, targets }, attractor } = composition
  backend.replaceClusters!({ membership, strengths, targets })
  backend.replaceAttractors!({ targets: attractor.targets, strengths: attractor.strengths })
  backend.setPositions(previousGpu)
  backend.setMouseRepulsion!(step.mouse)
  backend.setGpuFrame!(step.tick)
  const oracle = createCompositionOracle(composition)
  let positions = previousGpu
  let independent = previousCpu
  const results = []
  for (const { name, iteration } of stages(oracle, composition, step)) {
    const expected = oracle.stage(name, positions, step.alpha, step.tick, step.mouse, attractor, iteration)
    const independentStep = oracle.stage(name, independent, step.alpha, step.tick, step.mouse, attractor, iteration)
    if (name === 'cluster' || name === 'attractor' || name === 'mouse') backend.stepAdditionalForce!(name, step.alpha)
    else backend.stepStage(name, step.alpha)
    const current = await backend.read()
    const difference = compareArray(current.positions, independentStep.positions)
    const grid = name === 'repulsion' && positions.length / 4 > ALL_PAIRS_MAX_POINTS && difference.worstIndex >= 0
      ? compareGrid(positions, independent, witness, Math.floor(difference.worstIndex / 4))
      : undefined
    results.push({
      name,
      position: compareArray(current.positions, expected.positions),
      force: compareArray(current.forces, expected.forces),
      independent: difference,
      grid,
    })
    positions = current.positions
    independent = independentStep.positions
  }
  return { stages: results, stagedAgainstNormal: compareArray(positions, normal.positions) }
}

function visible (): void {
  expect(document.visibilityState).toBe('visible')
  expect(navigator.userAgent).not.toContain('HeadlessChrome')
  expect(devicePixelRatio).toBe(ratio)
}

function sourceInfo (): { source: string; snapshot: string; run: string } {
  const { LAB_SOURCE_REVISION: source, LAB_SOURCE_SNAPSHOT: snapshot, LAB_RUN_ID: run } = import.meta.env
  expect(source && snapshot && run).toBeTruthy()
  return { source, snapshot, run }
}

async function openViewport (runtime: Integrated): Promise<BrowserBounds> {
  runtime.resize(width, height, ratio)
  fit(runtime, runtime.data.input.points)
  await runtime.frame(false)
  const { bounds, viewport } = await commands.composedInput('layout')
  expect([bounds.width, bounds.height]).toEqual([width, height])
  expect([runtime.canvas.width, runtime.canvas.height]).toEqual([width * ratio, height * ratio])
  return { bounds, viewport }
}

async function panOnBackground (runtime: Integrated): Promise<void> {
  const before = { ...runtime.renderer.camera }
  const count = runtime.feedback.length
  await commands.composedInput('left-down', [6, 6])
  try {
    await vi.waitFor(() => expect(runtime.feedback.length).toBeGreaterThan(count))
    expect(runtime.feedback.at(-1)!.id).toBeNull()
    await commands.composedInput('move', [25, 18])
    await vi.waitFor(() => expect(runtime.renderer.camera.x).toBeLessThan(before.x))
    expect(runtime.renderer.camera.y).toBeGreaterThan(before.y)
  } finally { await commands.composedInput('left-up') }
}

async function profileFullForces (backend: Integrated['backend']): Promise<{
  status: TimerStatus; stages: string[]; samples: number[][];
}> {
  const { device } = backend.positionSource!()
  if (!device.features.has('timestamp-query')) return { status: 'unavailable', stages: [], samples: [] }
  const frozen = (await backend.read()).positions
  const alpha = 0.64
  const tick = 11
  backend.setMouseRepulsion!({ world: [0, 0], strength: 0.2 })
  backend.stepTick!(alpha, tick)
  const ordinary = await backend.read()
  const stages: string[] = []
  const samples: number[][] = []
  const query = device.createQuerySet({ type: 'timestamp', count: 64 })
  try {
    for (let i = 0; i < 7; i++) {
      visible()
      backend.setPositions(frozen)
      const names: string[] = []
      backend.stepProfiledTick!(alpha, tick, (name, encode) => {
        const index = names.length * 2
        names.push(name)
        const pass = device.beginComputePass({ timestampQuerySet: query, beginTimestampIndex: index, endTimestampIndex: index + 1 })
        try { encode(pass) } finally { pass.end() }
      })
      await waitForGpu(device)
      if (!stages.length) stages.push(...names)
      else expect(names).toEqual(stages)
      const result: { durations: number[] | null } = { durations: null }
      const timer = await readLumaTimer({
        async readTimestampDuration (): Promise<number> {
          result.durations = stageDurations(await query.readResults({ firstQuery: 0, queryCount: names.length * 2 }), names.length)
          return result.durations?.reduce((total, duration) => total + duration, 0) ?? NaN
        },
      })
      if (timer.status !== 'valid' || !result.durations) return { status: timer.status, stages, samples }
      samples.push(result.durations)
    }
    const profiled = await backend.read()
    expect(compareArray(profiled.positions, ordinary.positions).maxError).toBe(0)
    expect(compareArray(profiled.forces, ordinary.forces).maxError).toBe(0)
    return { status: 'valid', stages, samples }
  } finally { query.destroy(); backend.setMouseRepulsion!(undefined) }
}

for (const { kind, count, forces } of layouts) {
  it.skipIf(!nativeStudy)(`checks real input and projected composed motion on ${kind} / ${count}`, async () => {
    const run = sourceInfo()
    const artifact = `composed-motion-${kind}-${count}`
    const { host, canvas } = createCanvas()
    const record: Record<string, unknown> = { ...run, count, kind, forces, cooling, frames, mouseArithmetic, status: 'started' }
    type Row = ReturnType<typeof projectedError> & {
      kind: IntegratedForceStep['kind']; tick: number; alpha: number; scale: number;
      mouse?: IntegratedForceStep['mouse']; trusted: boolean; position: ReturnType<typeof compareArray>; force: ReturnType<typeof compareArray>;
    }
    const rows: Row[] = []
    let runtime: Integrated | undefined
    let fixture: Fixture | undefined
    let oracle: ReturnType<typeof createCompositionOracle>
    let priorGpu: Float32Array
    let priorCpu: Float32Array
    let initial: Float32Array
    let priorScale: number
    let firstPositionDifference: Witness | undefined
    let firstStrict: Witness | undefined
    let firstVisible: Witness | undefined
    try {
      visible()
      runtime = await createIntegrated(canvas, kind, count, {
        forces,
        decay: cooling,
        mouseArithmetic,
        async onForceStep ({ composition, ...step }): Promise<void> {
          visible()
          if (fixture !== composition || !fixture) {
            fixture = composition!
            oracle = createCompositionOracle(fixture)
          }
          let cpu: Snapshot = { positions: priorCpu, forces: new Float32Array(priorCpu.length) }
          for (const { name, iteration } of stages(oracle, fixture, step)) {
            cpu = oracle.stage(name, cpu.positions, step.alpha, step.tick, step.mouse, fixture.attractor, iteration)
          }
          const current = await runtime!.backend.read()
          const motion = motionChecks(initial, current.positions)
          expect([motion.nonfinite, motion.flagErrors, motion.fixedMoved]).toEqual([0, 0, 0])
          const pixels = projectedError(current.positions, cpu.positions, priorGpu, priorCpu, step.scale, priorScale)
          const position = compareArray(current.positions, cpu.positions)
          const force = compareArray(current.forces, cpu.forces)
          rows.push({
            ...pixels,
            kind: step.kind,
            tick: step.tick,
            alpha: step.alpha,
            scale: step.scale,
            mouse: step.mouse,
            trusted: step.trustedPointer,
            position,
            force,
          })
          const witness: Witness = { step, composition: fixture, previousGpu: priorGpu, previousCpu: priorCpu, normal: current }
          if (position.maxError > 0 && !firstPositionDifference) firstPositionDifference = witness
          if ((!position.valid || !force.valid) && !firstStrict) firstStrict = witness
          if (Math.max(pixels.positionPx, pixels.motionPx) > screenLimit && !firstVisible) {
            firstVisible = witness
          }
          priorGpu = current.positions
          priorCpu = cpu.positions
          priorScale = step.scale
          if (runtime!.tick >= frames) runtime!.pause()
        },
      })
      initial = runtime.data.input.points.slice()
      priorGpu = initial
      priorCpu = initial
      record.bounds = await openViewport(runtime)
      const environment = describeEnvironment(runtime.backend.positionSource!().device, canvas)
      expect(environment.device.fallback).toBe(false)
      record.environment = environment
      const startZoom = runtime.renderer.camera.zoom
      priorScale = startZoom * ratio
      await panOnBackground(runtime)
      const pointer: ScreenPoint = [Math.floor(width / 2) + 16, Math.floor(height / 2)]
      const world = runtime.world(pointer[0] * ratio, pointer[1] * ratio)
      await commands.composedInput('right-down', pointer)
      try {
        await vi.waitFor(() => expect(rows.filter(row => row.kind === 'mouse').length).toBeGreaterThanOrEqual(2), { timeout: 15000 })
      } finally { await commands.composedInput('right-up') }
      await runtime.settle()
      expect(runtime.tick).toBe(0)
      const paused = rows.filter(row => row.kind === 'mouse')
      expect(paused.every(row => row.trusted && !!row.mouse)).toBe(true)
      expect(paused[0].mouse?.world[0]).toBeCloseTo(world[0], 3)
      expect(paused[0].mouse?.world[1]).toBeCloseTo(world[1], 3)
      expect(motionChecks(initial, priorGpu).freeMoved).toBeGreaterThan(0)
      await nextFrame()
      expect(rows).toHaveLength(paused.length)

      const waitForTick = async (tick: number): Promise<void> => {
        await vi.waitFor(() => {
          expect(runtime!.error).toBe('')
          expect(runtime!.tick).toBeGreaterThanOrEqual(tick)
        }, { timeout: 45000 })
      }
      runtime.resume()
      await waitForTick(3)
      await commands.composedInput('right-down', pointer)
      try {
        await vi.waitFor(() => expect(rows.some(row => row.kind === 'tick' && row.trusted && !!row.mouse)).toBe(true), { timeout: 15000 })
      } finally { await commands.composedInput('right-up') }
      await waitForTick(16)
      runtime.pause()
      await runtime.settle()
      expect(rows.some(row => row.kind === 'tick' && !row.mouse)).toBe(true)

      await commands.composedInput('zoom-deep', [width / 2, height / 2])
      await vi.waitFor(() => expect(runtime!.renderer.camera.zoom).toBeGreaterThan(startZoom * 3))
      const current = runtime.composition!
      const nextCluster = changedMembership(current.cluster)
      runtime.replaceClusters({ membership: nextCluster.membership, strengths: nextCluster.strengths, targets: nextCluster.targets })
      runtime.replaceAttractors({ targets: undefined })
      const checkpoint = runtime.tick
      runtime.resume()
      await waitForTick(checkpoint + 4)
      runtime.pause()
      await runtime.settle()
      const nextAttractor = changedTargets(current.attractor)
      runtime.replaceAttractors({ targets: nextAttractor.targets, strengths: nextAttractor.strengths })
      runtime.resume()
      await waitForTick(frames)
      await runtime.settle()
      expect(rows.filter(row => row.kind === 'tick')).toHaveLength(frames)
      expect(rows.some(row => row.scale >= startZoom * ratio * 3)).toBe(true)

      record.rows = rows
      record.peakPositionPx = Math.max(...rows.map(row => row.positionPx))
      record.peakMotionPx = Math.max(...rows.map(row => row.motionPx))
      record.strictPositionPasses = rows.filter(row => row.position.valid).length
      record.strictForcePasses = rows.filter(row => row.force.valid).length

      // Use a real click on the rendered graph after the trajectory check.
      const camera = runtime.renderer.camera
      camera.x = initial[0]; camera.y = initial[1]
      await runtime.frame(false)
      const center: ScreenPoint = [Math.floor(width / 2), Math.floor(height / 2)]
      const expectedPick = await runtime.renderer.pick(center[0] * ratio, center[1] * ratio)
      expect(expectedPick).not.toBeNull()
      const beforePick = runtime.feedback.length
      await commands.composedInput('pick', center)
      await vi.waitFor(() => expect(runtime!.feedback.length).toBeGreaterThan(beforePick))
      expect(runtime.feedback.at(-1)!.id).toBe(expectedPick)
      record.pointPick = expectedPick

      const witnesses = new Map<Witness, string>()
      for (const [name, witness] of [['first-position', firstPositionDifference], ['strict', firstStrict], ['visible', firstVisible]] as const) {
        if (!witness) continue
        let file = witnesses.get(witness)
        if (!file) {
          file = `${artifact}-${name}`
          witnesses.set(witness, file)
          await writeArtifact(file, { ...run, ...witness, replay: await replayWitness(runtime.backend, witness) })
        }
        record[`${name}-witness`] = file
      }
      expect(record.peakPositionPx).toBeLessThanOrEqual(screenLimit)
      expect(record.peakMotionPx).toBeLessThanOrEqual(screenLimit)
      record.status = 'complete'
    } catch (error) {
      record.status = 'failed'
      record.error = String(error)
      record.rows = rows
      throw error
    } finally {
      runtime?.destroy()
      host.remove()
      await writeArtifact(artifact, record)
    }
  }, 240000)
}

for (const { kind, count, forces } of layouts.filter(layout => scaleStudy || (layout.count === 8192 && layout.forces === 'composed'))) {
  it.skipIf(!nativeStudy)(`measures readback-free composed frames on ${kind} / ${count}`, async () => {
    const run = sourceInfo()
    const { host, canvas } = createCanvas()
    const record: Record<string, unknown> = { ...run, kind, count, forces, cooling, mouseArithmetic, status: 'started' }
    let runtime: Integrated | undefined
    let hidden = document.visibilityState !== 'visible'
    const onVisibilityChange = (): void => { hidden ||= document.visibilityState !== 'visible' }
    document.addEventListener('visibilitychange', onVisibilityChange)
    try {
      visible()
      runtime = await createIntegrated(canvas, kind, count, { forces, decay: cooling, mouseArithmetic })
      record.bounds = await openViewport(runtime)
      const environment = describeEnvironment(runtime.backend.positionSource!().device, canvas)
      expect(environment.device.fallback).toBe(false)
      record.environment = environment
      runtime.resume()
      await vi.waitFor(() => expect(runtime!.intervals.length).toBeGreaterThanOrEqual(56), { timeout: 30000 })
      const intervals = runtime.intervals.slice(8, 56)
      const start = runtime.feedback.length
      const pointer: ScreenPoint = [width / 2, height / 2]
      await commands.composedInput('zoom-deep', pointer)
      await commands.composedInput('right-down', pointer)
      try {
        const heldAt = runtime.tick
        await vi.waitFor(() => expect(runtime!.tick).toBeGreaterThan(heldAt + 2), { timeout: 10000 })
      } finally { await commands.composedInput('right-up') }
      for (let i = 0; i < 8; i++) {
        await commands.composedInput('pick', [8, 8 + i * 3])
        await vi.waitFor(() => expect(runtime!.feedback.length).toBeGreaterThan(start + i), { timeout: 15000 })
      }
      runtime.pause()
      await runtime.settle()
      expect(runtime.error).toBe('')
      expect(hidden).toBe(false)
      record.frames = {
        intervals,
        median: percentile(intervals, 0.5),
        p95: percentile(intervals, 0.95),
        within: intervals.filter(interval => interval <= frameTarget).length,
      }
      record.picks = runtime.feedback.slice(start)
      record.pickWithinTarget = runtime.feedback.slice(start).filter(pick => pick.ms <= pickTarget).length
      if (scaleStudy) record.forceProfile = await profileFullForces(runtime.backend)
      record.status = 'complete'
    } catch (error) {
      record.status = 'failed'
      record.error = String(error)
      throw error
    } finally {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      runtime?.destroy()
      host.remove()
      await writeArtifact(`composed-interaction-${kind}-${count}`, record)
    }
  }, 120000)
}

const longStudy = import.meta.env.VITE_LAB_COMPOSED_LONG === '1'
for (const adaptive of [false, true]) {
  it.skipIf(!nativeStudy || !longStudy)(`cools all eight forces for 5,000 ticks with ${adaptive ? 'adaptive' : 'fixed'} samples`, async () => {
    const count = 8192
    const decay = 5000
    const { host, canvas } = createCanvas()
    const checkpoints: unknown[] = []
    const record: Record<string, unknown> = { ...sourceInfo(), count, decay, adaptive, checkpoints, status: 'started' }
    let runtime: Integrated | undefined
    try {
      visible()
      const viewer = await createIntegrated(canvas, 'communities', count, { forces: 'composed-collision', decay, adaptiveSampling: adaptive })
      runtime = viewer
      record.bounds = await openViewport(viewer)
      record.environment = describeEnvironment(viewer.backend.positionSource!().device, canvas)
      expect(viewer.backend.positionSource!().device.info.fallback).toBe(false)
      const initial = viewer.data.input.points.slice()
      // A tight group exercises the occupancy policy before the points spread.
      const dense = new Float32Array(512 * 4)
      for (let i = 0; i < 512; i++) dense.set([4 + (i % 32) * 0.002, 4 + Math.floor(i / 32) * 0.002, 0, 0], i * 4)
      viewer.patchPositions(2, dense)
      initial.set(dense, 8)
      const policy = createSamplingPolicy(count)
      const checksAt = new Set([1, 60, 200, 1000, 2500, decay])
      let previous: Float32Array = initial
      let samples = 8
      const started = performance.now()
      for (let tick = 1; tick <= decay; tick++) {
        if (tick % 25 === 0) visible()
        const probe = checksAt.has(tick)
        if (adaptive && probe) viewer.backend.requestOccupancy!()
        await viewer.frame(true)
        if (!probe) continue
        const positions = (await viewer.backend.read()).positions
        const motion = motionChecks(initial, positions)
        expect([motion.nonfinite, motion.flagErrors, motion.fixedMoved]).toEqual([0, 0, 0])
        const grid = await viewer.backend.readBounds!()
        const { finest } = layout(count)
        let changedCells = 0
        for (let id = 2; id < count; id++) {
          if (cellOf(previous[id * 4], previous[id * 4 + 1], finest, grid) !== cellOf(positions[id * 4], positions[id * 4 + 1], finest, grid)) changedCells++
        }
        const occupancy = adaptive ? await viewer.backend.readOccupancy!() : null
        const choice = occupancy ? policy.collect(occupancy) : null
        checkpoints.push({ tick, alpha: viewer.alpha, samples, choice, occupancy, changedCells, motion, quality: measureQuality(viewer, positions, previous) })
        if (choice && choice.applied !== samples) {
          samples = choice.applied
          viewer.backend.setSampling!(samples)
        }
        previous = positions
      }
      record.coolingMs = performance.now() - started
      expect(viewer.tick).toBe(decay)
      expect(viewer.alpha).toBeCloseTo(0.001, 6)
      await viewer.frame(true)
      const cooled = (await viewer.backend.read()).positions
      record.residual = displacement(cooled, previous)
      const beforeHeat = viewer.alpha
      viewer.resume()
      await commands.composedInput('right-down', [width / 2, height / 2])
      try { await vi.waitFor(() => expect(viewer.alpha).toBeGreaterThanOrEqual(0.1), { timeout: 15000 }) } finally { await commands.composedInput('right-up') }
      viewer.pause(true)
      await viewer.settle()
      const reheated = (await viewer.backend.read()).positions
      const motion = motionChecks(initial, reheated)
      expect([motion.nonfinite, motion.flagErrors, motion.fixedMoved]).toEqual([0, 0, 0])
      record.reheat = { before: beforeHeat, after: viewer.alpha, tick: viewer.tick, motion: displacement(reheated, cooled) }
      record.status = 'complete'
    } catch (error) {
      record.status = 'failed'
      record.error = String(error)
      throw error
    } finally { runtime?.destroy(); host.remove(); await writeArtifact(`composed-cooling-${adaptive ? 'adaptive' : 'fixed'}`, record) }
  }, 300000)
}
