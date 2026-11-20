import type { Device } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { createDevice, waitForGpu } from '../../gpu/luma'
import { writeArtifact } from '../../testing/artifacts'
import { cool } from '../combined-layout/data'
import { stageDurations } from '../combined-layout/stage-timing'
import { median, type TimestampWrites } from '../many-body/timing'
import { createDenseCommunities, communityDensity, denseFixtureParameters, type DenseCommunities } from '../million-graph/dense-communities'
import { checkpoints, layoutDifference, layoutSample, motionChecks, percentile, type LayoutSample } from '../million-graph/field-metrics'
import { trackMotion, type MotionResult } from '../million-graph/field-motion'
import { createInteractiveFixture } from '../million-graph/interactive-fixtures'
import { GRID_BUILD_STAGES } from '../spatial-grid/resources'
import { readLumaTimer, type TimerStatus } from '../weighted-links/timing'
import type { DistantForce } from './resident-cell-field'
import { createResidentGraph, RESIDENT_STAGES, type ResidentStage } from './resident-graph'

const nativeStudy = it.skipIf(!import.meta.env.LAB_DENSE_COMMUNITIES)
const nativeGridProfile = it.skipIf(!import.meta.env.LAB_DENSE_GRID_PROFILE)
const count = 1000000
const ticks = 200
const warmups = 3
const motionIds = 1026
const localScreenPx = 1
const lateCheckpoints = [50, 100, 200]
type ProfileStage = ResidentStage | typeof GRID_BUILD_STAGES[number]
const expandedStages = [...RESIDENT_STAGES.slice(0, 2), ...GRID_BUILD_STAGES, ...RESIDENT_STAGES.slice(2)]
type Graph = Awaited<ReturnType<typeof createResidentGraph>>
type Environment = {
  browser: string; webgl: Device['info']; luma: string; source: string; snapshot: string; runId: string;
  count: number; ticks: number; links: number; fixed: number; absent: number; seed: number; canvas: number[];
  fixture: typeof denseFixtureParameters;
}
type Profile = { status: TimerStatus; stages: readonly string[]; rows: number[][] | null; tail: ReturnType<typeof profileTail> | null }
type Lane = {
  snapshot: LayoutSample; checks: ReturnType<typeof motionChecks>; adapter: Device['info'];
  hierarchyBytes: number; linkBytes: number; profile?: Profile;
}
type LaneOptions = {
  profile?: 'stages' | 'expanded'; controlBox?: Float32Array; submitMs?: number[]; coarseLevels?: number;
  observe?: (graph: Graph, tick: number) => Promise<void>;
}

function assertVisible (): void {
  if (document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) throw new Error('Use visible native Chrome')
}

async function environment (fixture: DenseCommunities): Promise<Environment> {
  assertVisible()
  const runId: string = import.meta.env.LAB_RUN_ID
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(runId) || !import.meta.env.LAB_SOURCE_SNAPSHOT || !import.meta.env.LAB_SOURCE_REVISION) {
    throw new Error('Use a fresh artifact run with the exact source snapshot and base revision')
  }
  const device = await createDevice('webgl', document.createElement('canvas'))
  try {
    return {
      browser: navigator.userAgent,
      webgl: device.info,
      luma: '10.0.0-alpha.15',
      source: import.meta.env.LAB_SOURCE_REVISION,
      snapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
      runId,
      count,
      ticks,
      links: fixture.graph.links.length / 2,
      fixed: fixture.anchorCount + 1,
      absent: 1,
      seed: 29471,
      canvas: [480, 340],
      fixture: denseFixtureParameters,
    }
  } finally { device.destroy() }
}

function tickGroups (elapsed: number[]): { observed: number[]; tail: number[] } {
  const observed = elapsed.map((_, i) => i).slice(warmups)
  const tail = [...observed].sort((a, b) => elapsed[b] - elapsed[a]).slice(0, Math.ceil(observed.length * 0.05))
  return { observed, tail }
}

function profileTail (stages: readonly string[], rows: number[][], elapsed: number[]): {
  ticks: number[]; medianMs: number[]; tailMedianMs: number[]; medianUnmeasuredMs: number; tailUnmeasuredMs: number;
} {
  const { observed, tail } = tickGroups(elapsed)
  const residual = (i: number): number => elapsed[i] - rows[i].reduce((total, duration) => total + duration, 0)
  return {
    ticks: tail.map(i => i + 1),
    medianMs: stages.map((_, j) => median(observed.map(i => rows[i][j]))),
    tailMedianMs: stages.map((_, j) => median(tail.map(i => rows[i][j]))),
    medianUnmeasuredMs: median(observed.map(residual)),
    tailUnmeasuredMs: median(tail.map(residual)),
  }
}

async function runLane (
  fixture: DenseCommunities, mode: DistantForce, elapsed: number[], { profile, controlBox, submitMs, coarseLevels, observe }: LaneOptions = {}
): Promise<Lane> {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340; document.body.append(canvas)
  let backend: Graph | undefined
  try {
    backend = await createResidentGraph(canvas, fixture.input, fixture.graph, mode, { coarseLevels })
    if (backend.device.info.fallback !== false) throw new Error('Expected native WebGPU')
    const stages: readonly ProfileStage[] = profile === 'expanded' ? expandedStages : RESIDENT_STAGES
    const stageCount = stages.length
    const query = profile && backend.device.features.has('timestamp-query')
      ? backend.device.createQuerySet({ type: 'timestamp', count: ticks * stageCount * 2 })
      : undefined
    try {
      let alpha = 1
      for (let i = 0; i < ticks; i++) {
        assertVisible()
        const started = performance.now()
        const timestamp = query
          ? (stage: ProfileStage): TimestampWrites => {
            const slot = stages.indexOf(stage)
            if (slot < 0) throw new Error(`Unknown resident profile stage ${stage}`)
            const index = (i * stageCount + slot) * 2
            return { timestampQuerySet: query, beginTimestampIndex: index, endTimestampIndex: index + 1 }
          }
          : undefined
        backend.frame(i, alpha, true, timestamp, profile === 'expanded' ? timestamp : undefined)
        submitMs?.push(performance.now() - started)
        await waitForGpu(backend.device, 30000)
        elapsed.push(performance.now() - started)
        assertVisible()
        alpha = cool(alpha, ticks)
        if (observe) await observe(backend, i + 1)
      }
      const final = await backend.readPositions()
      const checks = motionChecks(fixture.input.points, final)
      expect([checks.nonfinite, checks.flagErrors, checks.fixedMoved]).toEqual([0, 0, 0])
      expect(checks.freeMoved).toBeGreaterThan(0)
      const lane: Lane = {
        snapshot: layoutSample(final, ticks, controlBox, fixture.firstAnchor),
        checks,
        adapter: backend.device.info,
        hierarchyBytes: backend.hierarchyBytes,
        linkBytes: backend.linkBytes,
      }
      if (profile) {
        let durations: number[] | null = null
        const timer = query
          ? await readLumaTimer({
            async readTimestampDuration (): Promise<number> {
              durations = stageDurations(await query.readResults({ firstQuery: 0, queryCount: ticks * stageCount * 2 }), ticks * stageCount)
              return durations ? durations.reduce((total, value) => total + value, 0) : NaN
            },
          })
          : { status: 'unavailable' as const }
        const rows = timer.status === 'valid' && durations
          ? Array.from({ length: ticks }, (_, i) => durations!.slice(i * stageCount, (i + 1) * stageCount))
          : null
        lane.profile = { status: timer.status, stages, rows, tail: rows ? profileTail(stages, rows, elapsed) : null }
      }
      return lane
    } finally { query?.destroy() }
  } finally { backend?.destroy(); canvas.remove() }
}

nativeStudy('times and profiles both resident solvers on persistent million-point communities', async () => {
  const fixture = createDenseCommunities(count)
  const metadata = await environment(fixture)
  const order = ['per-point', 'four-corners', 'four-corners', 'per-point'] as const
  const trials = [...order, 'per-point', 'four-corners'] as const
  const last = new Map<DistantForce, LayoutSample>()
  for (const [i, mode] of trials.entries()) {
    const profile = i >= order.length
    const name = `dense-${profile ? 'profile' : 'time'}-${i + 1}-${mode}`
    const base = { ...metadata, mode, order: i + 1, profile }
    const elapsed: number[] = []
    await writeArtifact(name, { ...base, status: 'running' })
    try {
      const control = last.get(mode)
      const lane = await runLane(fixture, mode, elapsed, { profile: profile ? 'stages' : undefined, controlBox: profile ? control?.box : undefined })
      const samples = elapsed.slice(warmups)
      if (!profile) last.set(mode, lane.snapshot)
      const profileDifference = profile && control ? layoutDifference(lane.snapshot, control) : null
      await writeArtifact(name, {
        ...base,
        status: 'complete',
        adapter: lane.adapter,
        warmups: elapsed.slice(0, warmups),
        samples,
        medianMs: median(samples),
        p95Ms: percentile(samples, 0.95),
        checks: lane.checks,
        hierarchyBytes: lane.hierarchyBytes,
        linkBytes: lane.linkBytes,
        stageTiming: lane.profile ?? null,
        profileDifference,
      })
    } catch (error) { await writeArtifact(name, { ...base, status: 'failed', elapsed, error: String(error) }); throw error }
  }
}, 1200000)

it.skipIf(import.meta.env.VITE_LAB_RESIDENT_DEEP_FIELD !== '1')('compares four and six shared levels in moving million-point layouts', async () => {
  for (const kind of ['dense', 'hubs'] as const) {
    const { input, graph, metadata } = createInteractiveFixture(count, kind)
    const anchorCount = metadata.pinnedCount - 1
    const fixture = { input, graph, anchorCount, firstAnchor: count - anchorCount }
    const environmentInfo = await environment(fixture)
    const first: LayoutSample[] = []
    const observe = async (candidate: Graph, tick: number): Promise<void> => {
      if (tick === 1) first.push(layoutSample(await candidate.readPositions(), tick, first[0]?.box, fixture.firstAnchor))
    }
    const artifact = `resident-deep-field-quality-${kind}`
    const record: Record<string, unknown> = { ...environmentInfo, metadata, status: 'started' }
    try {
      const reference = await runLane(fixture, 'four-corners', [], { coarseLevels: 4, observe })
      const candidate = await runLane(fixture, 'four-corners', [], { coarseLevels: 6, observe, controlBox: reference.snapshot.box })
      const oneTick = layoutDifference(first[1], first[0])
      const settled = layoutDifference(candidate.snapshot, reference.snapshot)
      record.adapter = candidate.adapter
      record.oneTick = oneTick
      record.settled = settled
      record.backingPixels = {
        oneTickP95: oneTick.p95Px * 1082 / 340,
        oneTickMax: oneTick.maxPx * 1082 / 340,
        settledP95: settled.p95Px * 1082 / 340,
      }
      record.checks = { reference: reference.checks, candidate: candidate.checks }
      record.status = 'complete'
    } catch (error) {
      record.status = 'failed'
      record.error = String(error)
      throw error
    } finally { await writeArtifact(artifact, record) }
  }
}, 180000)

function gridTail (elapsed: number[], submitMs: number[], profile?: Profile): {
  ticks: number[]; submitMedianMs: number; tailSubmitMedianMs: number; postSubmitMedianMs: number; tailPostSubmitMedianMs: number;
  gridMedianMs: number | null; tailGridMedianMs: number | null;
} {
  const { observed, tail } = tickGroups(elapsed)
  const { rows, stages } = profile ?? {}
  const slots = GRID_BUILD_STAGES.map(stage => stages?.indexOf(stage) ?? -1)
  const gridTimes = rows && slots.every(slot => slot >= 0) ? rows.map(row => slots.reduce((sum, slot) => sum + row[slot], 0)) : null
  const postSubmitMs = elapsed.map((duration, i) => duration - submitMs[i])
  return {
    ticks: tail.map(i => i + 1),
    submitMedianMs: median(observed.map(i => submitMs[i])),
    tailSubmitMedianMs: median(tail.map(i => submitMs[i])),
    postSubmitMedianMs: median(observed.map(i => postSubmitMs[i])),
    tailPostSubmitMedianMs: median(tail.map(i => postSubmitMs[i])),
    gridMedianMs: gridTimes ? median(observed.map(i => gridTimes[i])) : null,
    tailGridMedianMs: gridTimes ? median(tail.map(i => gridTimes[i])) : null,
  }
}

nativeGridProfile('times the resident spatial index on persistent million-point communities', async () => {
  const fixture = createDenseCommunities(count)
  const metadata = await environment(fixture)
  const modes = ['per-point', 'four-corners', 'four-corners', 'per-point'] as const
  const controls = new Map<DistantForce, LayoutSample>()
  const statuses: TimerStatus[] = []
  for (const [i, mode] of modes.entries()) {
    const profile = i >= 2
    const name = `dense-grid-${profile ? 'profile' : 'time'}-${i + 1}-${mode}`
    const base = { ...metadata, mode, order: i + 1, profile }
    const elapsed: number[] = []; const submitMs: number[] = []
    await writeArtifact(name, { ...base, status: 'running' })
    try {
      const control = controls.get(mode)
      const lane = await runLane(fixture, mode, elapsed, { profile: profile ? 'expanded' : undefined, controlBox: control?.box, submitMs })
      if (lane.profile) statuses.push(lane.profile.status)
      if (!profile) controls.set(mode, lane.snapshot)
      const samples = elapsed.slice(warmups)
      await writeArtifact(name, {
        ...base,
        status: 'complete',
        adapter: lane.adapter,
        warmups,
        elapsed,
        submitMs,
        medianMs: median(samples),
        p95Ms: percentile(samples, 0.95),
        checks: lane.checks,
        stageTiming: lane.profile ?? null,
        tail: gridTail(elapsed, submitMs, lane.profile),
        profileDifference: control ? layoutDifference(lane.snapshot, control) : null,
      })
    } catch (error) { await writeArtifact(name, { ...base, status: 'failed', elapsed, submitMs, error: String(error) }); throw error }
  }
  expect(statuses).toEqual(['valid', 'valid'])
}, 240000)

nativeStudy('checks persistent density, settled layouts and cell crossings at a million points', async () => {
  const fixture = createDenseCommunities(count)
  const metadata = await environment(fixture)
  const references = new Map<number, LayoutSample>()
  let controlMotion: MotionResult | undefined
  let controlDense = false
  for (const label of ['per-point', 'per-point-repeat', 'four-corners'] as const) {
    const mode = label === 'four-corners' ? label : 'per-point'
    const motion = trackMotion(fixture.input.points.slice(0, motionIds * 4), controlMotion?.tracers)
    const frames: Array<{
      tick: number; difference: ReturnType<typeof layoutDifference>; density: ReturnType<typeof communityDensity>;
      grid: number[]; box: number[]; sampledXY: number[];
    }> = []
    const base = { ...metadata, label, mode, localScreenPx, motionIds: motionIds - 2 }
    const name = `dense-layout-${label}`
    await writeArtifact(name, { ...base, status: 'running' })
    try {
      const lane = await runLane(fixture, mode, [], {
        observe: async (graph, tick) => {
          motion.add(tick, await graph.readMotionSample(motionIds))
          if (!checkpoints.includes(tick)) return
          const points = await graph.readPositions()
          const reference = references.get(tick)
          const view = layoutSample(points, tick, reference?.box, fixture.firstAnchor)
          if (label === 'per-point') references.set(tick, view)
          frames.push({
            tick,
            difference: layoutDifference(view, reference ?? view),
            density: communityDensity(fixture, points, view.box),
            grid: [...view.density],
            box: [...view.box],
            sampledXY: [...view.sample],
          })
        },
      })
      const tracked = motion.result()
      const dense = frames.filter(frame => lateCheckpoints.includes(frame.tick))
        .every(frame => frame.density.retainedFreeFraction >= 0.95 && frame.density.occupancyP95 > 8)
      if (label === 'per-point') controlDense = dense
      const settled = frames.filter(frame => lateCheckpoints.includes(frame.tick)).every(frame => frame.difference.p95Px <= localScreenPx)
      const crossings = tracked.turns.map((turn, i) => {
        const baseline = controlMotion?.turns[i].crossed.p95Px ?? null
        const candidate = turn.crossed.p95Px
        return {
          ticks: turn.ticks,
          level: turn.level,
          count: turn.crossed.count,
          p95Px: candidate,
          extraP95Px: baseline === null || candidate === null ? null : candidate - baseline,
        }
      })
      const lateCrossings = crossings.filter(row => row.ticks[0] >= 11)
      const withinMotionScreen = lateCrossings.every(row => row.extraP95Px === null || row.extraP95Px <= localScreenPx)
      const enoughCrossings = lateCrossings.every(row => row.extraP95Px !== null)
      let screen = 'reference'
      if (label !== 'per-point') {
        if (!controlDense || !dense || !enoughCrossings) screen = 'incomplete'
        else screen = settled && withinMotionScreen ? 'passed' : 'failed'
      }
      controlMotion ??= tracked
      await writeArtifact(name, {
        ...base, status: 'complete', adapter: lane.adapter, checks: lane.checks, dense, settled, screen, crossings, frames, motion: tracked,
      })
    } catch (error) { await writeArtifact(name, { ...base, status: 'failed', frames, error: String(error) }); throw error }
  }
}, 1200000)
