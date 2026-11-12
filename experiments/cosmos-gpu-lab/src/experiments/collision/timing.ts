import type { Snapshot } from '../many-body/reference'
import { compareArray } from '../many-body/reference'
import type { Measurement } from '../many-body/timing'
import { createOracle } from '../combined-layout/reference'
import type { CombinedBackend } from '../combined-layout/backend'
import { DEFAULT_CENTER_REDUCTION } from '../combined-layout/center-reduction'
import type { View } from '../many-body/backend'
import { collisionView } from './camera'
import { createFixture, type Settings } from './data'
import { createBackend, parametersFor, sequence, type Api } from './backend'
import { evaluate, sameBits, type Gate } from './checks'
export const COST_POLICY = { warmups: 4, samples: 12, frames: 4, blocks: 2 } as const
type Trial = { api: Api; enabled: boolean; block: number; round: number; warmup: boolean; valid: boolean; failedFrames: number; timing: Measurement }
export type CollisionCostReport = {
  comparison?: 'collision' | 'center-reduction';
  camera: View;
  frozenTick: number;
  recordedAt: string; browser: string; settings: Settings; input: Float32Array; policy: { warmups: number; samples: number; frames: number; blocks: number };
  status: string; devices: Partial<Record<Api, string>>; preflight: Array<{ api: Api; enabled: boolean; gate: Gate }>;
  trials: Trial[]; errors: string[];
  failure?: { api: Api; enabled: boolean; input: Float32Array; actual: Snapshot; expected: Snapshot; gate?: Gate };
}
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b); const n = sorted.length
  return n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
}
export function collisionCostSummary (report: CollisionCostReport, api: Api, block: number): {
  accepted: boolean; offMs: number | null; onMs: number | null; deltaMs: number | null; range: [number, number] | null; percent: number | null;
} {
  const all = report.trials.filter(t => t.api === api && t.block === block); const measured = all.filter(t => !t.warmup)
  const gates = report.preflight.filter(p => p.api === api)
  const valid = report.status === 'complete' && gates.length === 2 && gates.some(p => p.enabled) && gates.some(p => !p.enabled) &&
    gates.every(p => p.gate.valid) &&
    all.length === (report.policy.warmups + report.policy.samples) * 2 && measured.length === report.policy.samples * 2 &&
    all.every(t => t.valid && t.timing.timerStatus === 'valid' && t.timing.operations === (api === 'webgpu' ? report.policy.frames : 1) &&
      t.timing.batchGpuMs !== null && Number.isFinite(t.timing.batchGpuMs) && t.timing.batchGpuMs >= 0) &&
    Array.from({ length: report.policy.warmups + report.policy.samples }, (_, i) => i)
      .every(round => all.filter(t => t.round === round && t.enabled).length === 1 && all.filter(t => t.round === round && !t.enabled).length === 1)
  if (!valid) return { accepted: false, offMs: null, onMs: null, deltaMs: null, range: null, percent: null }
  const ms = (trial: Trial): number => trial.timing.batchGpuMs! / trial.timing.operations
  const off = measured.filter(t => !t.enabled); const on = measured.filter(t => t.enabled)
  const differences = off.map(t => ms(on.find(s => s.round === t.round)!) - ms(t))
  const offMs = median(off.map(ms)); const onMs = median(on.map(ms)); const deltaMs = median(differences)
  return { accepted: true, offMs, onMs, deltaMs, range: [Math.min(...differences), Math.max(...differences)], percent: offMs ? 100 * deltaMs / offMs : null }
}
export async function measureCollisionCost (
  settings: Settings, frozen: Float32Array, progress: (text: string) => void, cancelled: () => boolean,
  policy: CollisionCostReport['policy'] = COST_POLICY, frozenTick = 0, comparison: NonNullable<CollisionCostReport['comparison']> = 'collision'
): Promise<CollisionCostReport> {
  if (!(settings.collision.strength > 0) || ![policy.warmups, policy.samples, policy.frames, policy.blocks].every(Number.isInteger) || policy.warmups < 0 ||
    policy.samples < 2 || policy.frames < 1 || policy.frames > 8 || policy.blocks < 1 || policy.blocks > 4) throw new Error('Invalid collision timing settings')
  if (comparison === 'center-reduction' && settings.mode !== 'combined') throw new Error('Center comparison requires combined forces')
  const { input, graph } = createFixture(settings.fixture, settings.count, settings.topology)
  if (frozen.length !== input.points.length) throw new Error('Frozen input size differs')
  input.points = frozen.slice(); graph.points = input.points
  const report: CollisionCostReport = {
    comparison,
    frozenTick,
    camera: collisionView([frozen], graph.sizes, settings.collision),
    recordedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    settings: { ...settings, collision: { ...settings.collision }, centerReduction: settings.centerReduction ?? DEFAULT_CENTER_REDUCTION },
    input: frozen.slice(),
    policy: { ...policy },
    status: 'running',
    devices: {},
    preflight: [],
    trials: [],
    errors: [],
  }
  const configs = (comparison === 'center-reduction' ? ['webgpu'] as const : ['webgl', 'webgpu'] as const).map(api => {
    const parameters = parametersFor(settings)
    return {
      api,
      parameters,
      oracle: createOracle(graph, input, 'production', parameters),
      backend: undefined as CombinedBackend | undefined,
      anchors: new Map<boolean, Snapshot>(),
      expected: new Map<boolean, Snapshot>(),
    }
  })
  const strength = settings.collision.strength
  const select = (parameters: ReturnType<typeof parametersFor>, enabled: boolean): void => {
    if (comparison === 'center-reduction') parameters.centerReduction = enabled ? 'high-low' : 'f32'
    else parameters.collision!.strength = enabled ? strength : 0
  }
  try {
    for (const config of configs) {
      progress(`Preparing ${config.api} collision timing…`)
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
      const b = config.backend = await createBackend(config.api, canvas, graph, input, config.parameters)
      report.devices[config.api] = b.info
      for (const enabled of [false, true]) {
        select(config.parameters, enabled)
        const result = await evaluate(b, config.oracle, sequence(settings.mode, config.parameters), frozen, settings.alpha)
        report.preflight.push({ api: config.api, enabled, gate: result.gate })
        config.anchors.set(enabled, result.actual); config.expected.set(enabled, result.expected)
        if (!result.gate.valid && !report.failure) {
          report.failure = {
            api: config.api, enabled, input: frozen.slice(), actual: result.actual, expected: result.expected, gate: result.gate,
          }
        }
      }
    }
    const outputs = configs.flatMap(c => [...c.anchors.values()].map(s => s.positions))
    const view = report.camera = collisionView([frozen, ...outputs], graph.sizes, settings.collision)
    for (let block = 0; block < policy.blocks; block++) {
      for (const config of block % 2 ? [...configs].reverse() : configs) {
        const { api, backend: b, parameters } = config
        for (let round = 0; round < policy.warmups + policy.samples; round++) {
          for (const enabled of (round + block) % 2 ? [true, false] : [false, true]) {
            if (cancelled()) { report.status = 'cancelled'; return report }
            if (document.visibilityState !== 'visible') throw new Error('Keep the lab tab visible while timing')
            progress(`${api} · block ${block + 1}/${policy.blocks} · pair ${round + 1}/${policy.warmups + policy.samples} · ${
              comparison === 'center-reduction' ? `center ${enabled ? 'high/low' : 'f32'}` : `collision ${enabled ? 'on' : 'off'}`}`)
            select(parameters, enabled)
            const stages = sequence(settings.mode, parameters); b!.setPositions(frozen)
            const result = api === 'webgpu'
              ? await b!.measureFrozenFrames!({ frames: policy.frames, alpha: settings.alpha, tick: 0, view, stages })
              : await b!.measureCurrentFrame!(settings.alpha, 0, view, stages).then(r => ({ timing: r.timing, snapshots: [r.snapshot] }))
            const anchor = config.anchors.get(enabled)!; const expected = config.expected.get(enabled)!
            // An off collision-only frame has no force output. Its stale scratch
            // buffer is deliberately excluded; every position is still checked.
            const failures = result.snapshots.filter(s => !sameBits(s.positions, anchor.positions) ||
            (stages.length > 0 && !sameBits(s.forces, anchor.forces)) || !compareArray(s.positions, expected.positions, frozen).valid)
            report.trials.push({
              api,
              enabled,
              block,
              round,
              warmup: round < policy.warmups,
              valid: !failures.length && result.snapshots.length === (api === 'webgpu' ? policy.frames : 1),
              failedFrames: failures.length,
              timing: result.timing,
            })
            if (failures.length && !report.failure) report.failure = { api, enabled, input: frozen.slice(), actual: failures[0], expected }
            await new Promise(resolve => setTimeout(resolve, 0))
          }
        }
      }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.errors.push(String(error)) } finally { configs.forEach(c => c.backend?.destroy()) }
  return report
}
