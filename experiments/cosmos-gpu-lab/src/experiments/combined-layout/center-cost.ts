import type { Snapshot } from '../many-body/reference'
import { compareArray } from '../many-body/reference'
import { compareArray as springCompare } from '../weighted-links/reference'
import type { Measurement } from '../many-body/timing'
import { frameFor, type Frame } from '../many-body-grid/data'
import { sharedView } from '../matched-layout/metrics'
import type { Settings } from '../matched-layout/session'
import { createGraph, stagesFor } from './data'
import { createOracle } from './reference'
import { centerAggregate } from './center-reference'
import { forceSettings } from './production-settings'
import { createCombinedWebGL } from './webgl'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
import { DEFAULT_CENTER_REDUCTION, type CenterReduction } from './center-reduction'
export const CENTER_COST_POLICY = { warmups: 4, samples: 12, frames: 4, blocks: 2 } as const
type Api = 'webgl' | 'webgpu'
type Gate = { valid: boolean; stages: Array<{ stage: string; forceFailures: number; positionFailures: number; aggregateFailures: number; flagsExact: boolean }>;
  wholeTick: ReturnType<typeof compareArray>; }
type Trial = { block: number; round: number; warmup: boolean; api: Api; center: number; timing: Measurement; valid: boolean; mismatchedFrames: number }
export type CenterCostReport = {
  centerReduction?: CenterReduction;
  settings: Settings; alpha: number; tick: number; samples: number; strength: number; recordedAt: string; browser: string;
  policy: { warmups: number; samples: number; frames: number; blocks: number }; status: string;
  input: Float32Array;
  devices: Partial<Record<Api, string>>; preflight: Array<{ api: Api; center: number; gate: Gate }>;
  trials: Trial[]; errors: string[]; failure?: { api: Api; center: number; input: Float32Array; actual: Snapshot; expected: Float32Array; gate?: Gate };
}
function median (values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
export function centerCostSummary (report: CenterCostReport, api: Api, block: number): {
  accepted: boolean; offMs: number | null; onMs: number | null; deltaMs: number | null; deltaRange: [number, number] | null; percent: number | null;
} {
  const all = report.trials.filter(t => t.api === api && t.block === block)
  const trials = all.filter(t => !t.warmup)
  const gates = report.preflight.filter(p => p.api === api)
  const valid = report.status === 'complete' && gates.length === 2 && gates.every(p => p.gate.valid) &&
    all.length === (report.policy.warmups + report.policy.samples) * 2 &&
    trials.length === report.policy.samples * 2 && all.every(t => t.valid && t.timing.timerStatus === 'valid' && t.timing.batchGpuMs !== null &&
      Number.isFinite(t.timing.batchGpuMs) && t.timing.batchGpuMs >= 0 && t.timing.operations === (api === 'webgpu' ? report.policy.frames : 1)) &&
    Array.from({ length: report.policy.samples }, (_, i) => i + report.policy.warmups)
      .every(round => trials.filter(t => t.round === round && t.center === 0).length === 1 &&
        trials.filter(t => t.round === round && t.center === report.strength).length === 1)
  if (!valid) return { accepted: false, offMs: null, onMs: null, deltaMs: null, deltaRange: null, percent: null }
  const perFrame = (t: Trial): number => t.timing.batchGpuMs! / t.timing.operations
  const off = trials.filter(t => t.center === 0); const on = trials.filter(t => t.center !== 0)
  const differences = off.map(t => perFrame(on.find(c => c.round === t.round)!) - perFrame(t))
  const offMs = median(off.map(perFrame)); const onMs = median(on.map(perFrame)); const deltaMs = median(differences)
  return {
    accepted: true,
    offMs,
    onMs,
    deltaMs,
    deltaRange: [Math.min(...differences), Math.max(...differences)],
    percent: offMs ? 100 * deltaMs / offMs : null,
  }
}
export async function measureCenterCost (
  settings: Settings, frozen: Float32Array, alpha: number, tick: number, samples: number,
  progress: (text: string) => void, cancelled: () => boolean, policy: CenterCostReport['policy'] = CENTER_COST_POLICY
): Promise<CenterCostReport> {
  if (![policy.warmups, policy.samples, policy.frames, policy.blocks].every(Number.isInteger) || policy.warmups < 0 || policy.samples < 2 ||
    policy.frames < 1 || policy.frames > 64 || policy.blocks < 1 || policy.blocks > 4) throw new Error('Invalid center timing policy')
  const strength = settings.center ?? 0
  if (!(strength > 0) || !Number.isFinite(strength)) throw new Error('Choose a positive center force before timing')
  const { graph, input } = createGraph({ count: settings.count, fixture: settings.fixture, decay: settings.ticks })
  if (frozen.length !== input.points.length) throw new Error('Frozen graph size differs')
  input.points = frozen.slice(); graph.points = input.points
  const report: CenterCostReport = {
    centerReduction: DEFAULT_CENTER_REDUCTION,
    settings: { ...settings },
    alpha,
    tick,
    samples,
    strength,
    recordedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    policy: { ...policy },
    input: frozen.slice(),
    status: 'running',
    devices: {},
    preflight: [],
    trials: [],
    errors: [],
  }
  const configurations = (['webgl', 'webgpu'] as const).map(api => {
    const parameters = { ...forceSettings(settings.preset, settings.count), samples, center: strength, origin: [2048, 2048] as [number, number] }
    return {
      api,
      parameters,
      oracle: createOracle(graph, input, 'production', parameters),
      backend: undefined as CombinedBackend | undefined,
      anchors: new Map<number, Snapshot>(),
      expected: new Map<number, Float32Array>(),
      frames: new Map<number, Frame>(),
    }
  })
  const same = (a: Float32Array, b: Float32Array): boolean => {
    const x = new Uint32Array(a.buffer, a.byteOffset, a.length); const y = new Uint32Array(b.buffer, b.byteOffset, b.length)
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  const view = sharedView([frozen])
  try {
    for (const config of configurations) {
      const { api, parameters, oracle } = config
      progress(`Preparing ${api} center-cost control…`)
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
      config.backend = api === 'webgl'
        ? await createCombinedWebGL(canvas, graph, input, { forceSettings: parameters, repulsionPolicy: 'production' })
        : await createCombinedWebGPU(canvas, graph, input, 'trig', {
          forceSettings: parameters, repulsionPolicy: 'production', gpuBounds: true, gridAggregation: 'cached-small', springOptimization: 'prefetch',
        })
      const b = config.backend; report.devices[api] = b.info
      for (const center of [0, strength]) {
        parameters.center = center; b.setPositions(frozen); b.setGpuFrame?.(tick)
        let previous = frozen; const stages: Gate['stages'] = []; let actual: Snapshot | undefined
        for (const stage of stagesFor(center)) {
          if (api === 'webgl' && stage === 'repulsion') {
            const frame = frameFor(previous, tick, samples, parameters.precise); config.frames.set(center, frame); b.setFrame(frame)
          }
          const expected = oracle.stage(stage, previous, alpha, tick)
          b.stepStage(stage, alpha); actual = await b.read()
          const compare = stage === 'incoming' || stage === 'outgoing' ? springCompare : compareArray
          stages.push({
            stage,
            forceFailures: compare(actual.forces, expected.forces).failures,
            positionFailures: compare(actual.positions, expected.positions).failures,
            aggregateFailures: stage === 'center' ? compareArray(await b.readCenter!(), centerAggregate(previous)).failures : 0,
            flagsExact: actual.positions.every((v, i) => i % 4 < 2 || v === expected.positions[i]) &&
              actual.forces.every((v, i) => i % 4 < 2 || v === expected.forces[i]),
          })
          previous = actual.positions
        }
        const expected = oracle.tick(frozen, alpha, tick); const wholeTick = compareArray(previous, expected)
        const gate: Gate = {
          stages,
          wholeTick,
          valid: wholeTick.valid && stages.every(s => !s.forceFailures && !s.positionFailures && !s.aggregateFailures && s.flagsExact),
        }
        report.preflight.push({ api, center, gate }); config.anchors.set(center, actual!); config.expected.set(center, expected)
        if (!gate.valid && !report.failure) report.failure = { api, center, input: frozen.slice(), actual: actual!, expected, gate }
      }
    }
    for (let block = 0; block < policy.blocks; block++) {
      const order = block % 2 ? [...configurations].reverse() : configurations
      for (const config of order) {
        const { api, backend: b, parameters } = config
        for (let round = 0; round < policy.warmups + policy.samples; round++) {
          for (const center of (round + block) % 2 ? [strength, 0] : [0, strength]) {
            if (cancelled()) { report.status = 'cancelled'; return report }
            if (document.visibilityState !== 'visible') throw new Error('Keep the lab tab visible while measuring GPU cost')
            progress(`${api} · block ${block + 1}/${policy.blocks} · pair ${round + 1}/${policy.warmups + policy.samples} · center ${center}`)
            parameters.center = center; b!.setPositions(frozen)
            let result: { timing: Measurement; snapshots: Snapshot[] }
            if (api === 'webgpu') result = await b!.measureFrozenFrames!({ frames: policy.frames, alpha, tick, view })
            else {
              // CPU bounds setup and upload are outside the GL GPU timer. The
              // timed frame contains unchanged production GPU passes and draw.
              b!.setFrame(config.frames.get(center)!)
              const frame = await b!.measureCurrentFrame!(alpha, tick, view)
              result = { timing: frame.timing, snapshots: [frame.snapshot] }
            }
            const anchor = config.anchors.get(center)!; const expected = config.expected.get(center)!
            const failed = result.snapshots.filter(s => !same(s.positions, anchor.positions) || !same(s.forces, anchor.forces) ||
              !compareArray(s.positions, expected).valid)
            const valid = !failed.length && result.snapshots.length === (api === 'webgpu' ? policy.frames : 1)
            report.trials.push({ block, round, warmup: round < policy.warmups, api, center, timing: result.timing, valid, mismatchedFrames: failed.length })
            if (failed.length && !report.failure) report.failure = { api, center, input: frozen.slice(), actual: failed[0], expected }
            await new Promise(resolve => setTimeout(resolve, 0))
          }
        }
      }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.errors.push(String(error)) } finally { configurations.forEach(c => c.backend?.destroy()) }
  return report
}
