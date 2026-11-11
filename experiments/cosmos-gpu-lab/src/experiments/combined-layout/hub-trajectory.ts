import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { fitView } from '../many-body/backend'
import { compareArray, TOLERANCE, type Snapshot } from '../many-body/reference'
import { compareArray as springCompare, TOLERANCE as SPRING_TOLERANCE } from '../weighted-links/reference'
import { cool, STAGES, type Stage } from './data'
import { createOracle } from './reference'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
import { differingBits } from './resident'
import { profileCheck, fingerprint } from './controlled-profile'
import { createHubGraph } from './hub-spring-data'
import type { HubCapture } from './hub-study'

export type HubTrajectorySettings = { count: number; degree: number; pinned: boolean; threshold: number; decay: number; checkpointEvery: number }
type StageCheck = {
  stage: Stage; positions: number; forces: number;
  cpu: Array<{ positions: ReturnType<typeof springCompare>; forces: ReturnType<typeof springCompare> }>; valid: boolean;
}
type Checkpoint = {
  tick: number; alpha: number; probe: boolean; input: string; startDifferences: number;
  stages: StageCheck[]; normal: ReturnType<typeof profileCheck>[]; valid: boolean;
}
export type HubTrajectoryReport = {
  experiment: 'hub-trajectory'; browser: string; gpuApi: 'luma'; settings: HubTrajectorySettings; info: string; sameDevice: boolean;
  tolerance: typeof TOLERANCE; springTolerance: typeof SPRING_TOLERANCE;
  status: 'ready' | 'running' | 'complete' | 'cancelled' | 'failed'; tick: number; alpha: number;
  initial: number[]; samples: number[]; checkpoints: Checkpoint[]; final?: number[]; cleanup?: number[]; error?: string;
  failure?: {
    tick: number; alpha: number; stage: string; input: number[];
    actual: { positions: number[]; forces: number[] }; expected: { positions: number[]; forces: number[] };
  };
}

// Resident evolution is never reset to the CPU. At checkpoints only, replay the
// SAME tick stage by stage, then restore its checked normal-frame output.
export async function createHubTrajectory (canvas: HTMLCanvasElement, settings: HubTrajectorySettings): Promise<{
  report: HubTrajectoryReport; run(options: { cancelled(): boolean; progress(message: string): void }): Promise<void>;
  finalCapture(probe: boolean): HubCapture; destroy(): void; remainingBytes(): number[];
}> {
  if (![settings.count, settings.degree, settings.decay, settings.checkpointEvery].every(Number.isInteger) ||
    settings.count < 16 || settings.count > 8192 || settings.decay < 1 || settings.decay > 300 ||
    settings.checkpointEvery < 1 || settings.checkpointEvery > settings.decay) throw new Error('Invalid hub trajectory settings')
  const { graph, input } = createHubGraph(settings.count, settings.degree, settings.pinned)
  const oracle = createOracle(graph, input); const view = fitView([input.points])
  let deviceFailure: string | undefined; let destroyed = false; let started = false
  const device = await createDevice('webgpu', canvas, true, error => { deviceFailure = error.message })
  const ledgers = [new BufferLedger(), new BufferLedger()]; const backends: CombinedBackend[] = []
  const check = (): void => { if (destroyed || deviceFailure || device.isLost) throw new Error(deviceFailure ?? 'Hub trajectory unavailable') }
  const remainingBytes = (): number[] => ledgers.map(l => l.liveBytes)
  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    try { for (const b of backends) b.destroy() } finally { device.destroy() }
  }
  try {
    for (const [lane, springOptimization] of (['baseline', 'prefetch'] as const).entries()) {
      backends.push(await createCombinedWebGPU(canvas, graph, input, 'trig', {
        gpuBounds: true, springOptimization, hubThreshold: settings.threshold, context: { device, ledger: ledgers[lane], check },
      }))
    }
  } catch (error) { destroy(); throw error }
  const report: HubTrajectoryReport = {
    experiment: 'hub-trajectory',
    browser: navigator.userAgent,
    gpuApi: 'luma',
    settings: { ...settings },
    info: backends[0].info,
    sameDevice: backends.every(b => b.positionSource!().device === device),
    tolerance: TOLERANCE,
    springTolerance: SPRING_TOLERANCE,
    status: 'ready',
    tick: 0,
    alpha: 1,
    initial: Array.from(input.points),
    samples: Array.from(input.samples),
    checkpoints: [],
  }
  const fail = (tick: number, alpha: number, stage: string, input: Float32Array, actual: Snapshot, expected: Snapshot): void => {
    const arrays = (s: Snapshot): { positions: number[]; forces: number[] } => ({ positions: Array.from(s.positions), forces: Array.from(s.forces) })
    report.failure ??= { tick, alpha, stage, input: Array.from(input), actual: arrays(actual), expected: arrays(expected) }
  }
  const checkpoint = async (tick: number, alpha: number, probe: boolean): Promise<void> => {
    const starts = await Promise.all(backends.map(b => b.read())); const start = starts[0].positions
    const row: Checkpoint = {
      tick: tick + 1,
      alpha,
      probe,
      input: fingerprint(start),
      startDifferences: differingBits(start, starts[1].positions),
      stages: [],
      normal: [],
      valid: false,
    }
    report.checkpoints.push(row)
    if (row.startDifferences) {
      fail(tick, alpha, 'trajectory input', start, starts[1], starts[0]); throw new Error('Trajectory inputs differ')
    }
    const cpuWhole = oracle.tick(start, alpha, tick)
    const normal: Snapshot[] = []
    // Both paths retain their ordinary single-compute-pass frame. These anchor
    // durations are NOT accepted as benchmark samples; repeat timing separately.
    for (const b of backends) normal.push((await b.measureCurrentFrame!(alpha, tick, view)).snapshot)
    for (const b of backends) { b.setPositions(start); b.setGpuFrame!(tick) }
    let current = start; let staged: Snapshot[] = []
    for (const stage of STAGES) {
      check()
      const expected = oracle.stage(stage, current, alpha, tick)
      for (const b of backends) b.stepStage(stage, alpha)
      staged = await Promise.all(backends.map(b => b.read()))
      const compare = stage === 'incoming' || stage === 'outgoing' ? springCompare : compareArray
      const cpu = staged.map(s => ({ positions: compare(s.positions, expected.positions), forces: compare(s.forces, expected.forces) }))
      const positions = differingBits(staged[0].positions, staged[1].positions); const forces = differingBits(staged[0].forces, staged[1].forces)
      const valid = !positions && !forces && cpu.every(c => c.positions.valid && c.forces.valid)
      row.stages.push({ stage, positions, forces, cpu, valid })
      if (!valid) {
        const cpuLane = cpu.findIndex(c => !c.positions.valid || !c.forces.valid)
        fail(tick, alpha, `${stage} ${cpuLane < 0 ? 'replay' : 'CPU'}`, current, staged[cpuLane < 0 ? 1 : cpuLane], cpuLane < 0 ? staged[0] : expected)
        throw new Error(`Trajectory stage failed: ${stage} at tick ${tick + 1}`)
      }
      current = staged[0].positions
    }
    row.normal = normal.map((s, lane) => profileCheck(s, staged[lane], cpuWhole))
    row.valid = row.normal.every(c => c.valid) && !differingBits(normal[0].positions, normal[1].positions) &&
      !differingBits(normal[0].forces, normal[1].forces)
    if (!row.valid) {
      const lane = row.normal.findIndex(c => !c.valid)
      fail(tick, alpha, 'normal frame / whole-tick CPU', start, normal[Math.max(0, lane)], staged[Math.max(0, lane)])
      throw new Error(`Normal trajectory frame failed at tick ${tick + 1}`)
    }
    backends.forEach((b, lane) => b.setPositions(probe ? starts[lane].positions : normal[lane].positions))
    if (probe) backends[0].render(view)
  }
  return {
    report,
    destroy,
    remainingBytes,
    finalCapture (probe): HubCapture {
      if (report.status !== 'complete' || !report.final) throw new Error('Complete a passing trajectory first')
      return { positions: new Float32Array(report.final), alpha: probe ? 1 : report.alpha, tick: report.tick }
    },
    async run ({ cancelled, progress }): Promise<void> {
      if (started) throw new Error('Hub trajectory already started')
      started = true; report.status = 'running'
      try {
        if (!report.sameDevice) throw new Error('Trajectory lanes must share one device')
        for (let tick = 0; tick < settings.decay; tick++) {
          if (cancelled()) { report.status = 'cancelled'; return }
          check(); progress(`Trajectory tick ${tick + 1}/${settings.decay} · alpha ${report.alpha.toPrecision(3)}`)
          const checked = tick === 0 || tick + 1 === settings.decay || (tick + 1) % settings.checkpointEvery === 0
          if (checked) await checkpoint(tick, report.alpha, false)
          else for (const b of backends) { b.stepTick!(report.alpha, tick); b.render(view) }
          report.tick = tick + 1; report.alpha = cool(report.alpha, settings.decay)
          await new Promise(resolve => setTimeout(resolve, 0))
        }
        if (cancelled()) { report.status = 'cancelled'; return }
        progress('Checking a restoring full-strength probe on the final geometry…')
        await checkpoint(report.tick, 1, true)
        report.final = Array.from((await backends[0].read()).positions); report.status = 'complete'
      } catch (error) { report.status = 'failed'; report.error = String(error) } finally { destroy(); report.cleanup = remainingBytes() }
    },
  }
}
export type HubTrajectory = Awaited<ReturnType<typeof createHubTrajectory>>
