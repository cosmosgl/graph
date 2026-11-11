import { compareArray, TOLERANCE } from '../many-body/reference'
import { compareArray as springCompare } from '../weighted-links/reference'
import { frameFor } from '../many-body-grid/data'
import { STAGES, createGraph, type Stage } from './data'
import { validateGravityTrig, type TrigValidation } from './gravity-trig-validation'
import { traceGravity, type GravityTrace } from './gravity-trace'
import { createOracle } from './reference'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedSession } from './session'
const sameBits = (a: Float32Array, b: Float32Array): boolean => {
  const aa = new Uint32Array(a.buffer, a.byteOffset, a.length); const bb = new Uint32Array(b.buffer, b.byteOffset, b.length)
  return aa.length === bb.length && aa.every((v, i) => v === bb[i])
}
type Check = ReturnType<typeof springCompare>
export type TickIsolation = {
  trigValidation?: TrigValidation;
  gravity?: GravityTrace;
  refinedGravity?: GravityTrace;
  capture: string; tick: number; alpha: number; baselineMatchesCapture: boolean;
  components: Array<{ point: number; axis: number; actual: number; expected: number; budget: number }>;
  stages: Array<{
    stage: Stage; localForce: Check; localPosition: Check; composedForce: Check; composedPosition: Check;
    points: Array<{ point: number; cpu: number[]; gpu: number[]; cpuForce: number[]; gpuForce: number[] }>;
  }>;
  ablations: Array<{ name: string; kind: 'boundary' | 'kernel'; positions: Check; components: number[] }>;
}
// Boundary replacements are causal diagnostics only. They are never a GPU implementation candidate.
export async function isolateTickFailure (session: CombinedSession, cancelled: () => boolean = (): boolean => false): Promise<TickIsolation> {
  if (!['products', 'composed', 'aligned', 'trig'].includes(session.settings.springPrecision ?? 'baseline')) {
    throw new Error('Tick isolation requires a products, repulsion-rounded, or aligned capture')
  }
  const key = session.firstTickFailures['probe-webgpu'] ? 'probe-webgpu' : 'webgpu'
  const capture = session.firstTickFailures[key]
  if (!capture) throw new Error('Capture a WebGPU whole-tick failure first')
  const { graph, input } = createGraph(session.settings); const oracle = createOracle(graph, input)
  const components = Array.from(capture.actual).flatMap((actual, i) => {
    const expected = capture.expected[i]; const budget = TOLERANCE.absolute + TOLERANCE.relative * Math.abs(expected)
    return Math.abs(actual - expected) > budget ? [{ point: Math.floor(i / 4), axis: i % 4, actual, expected, budget }] : []
  })
  const points = [...new Set([0, ...components.map(c => c.point)])]
  const report: TickIsolation = {
    capture: key,
    tick: capture.tick,
    alpha: capture.alpha,
    components,
    baselineMatchesCapture: false,
    stages: [],
    ablations: [],
  }
  const variants: Array<{ name: string; rounded: Stage[]; boundary?: Stage; polar?: boolean; trig?: boolean }> = [
    { name: 'original', rounded: [] },
    { name: 'CPU gravity boundary', rounded: [], boundary: 'gravity' },
    { name: 'CPU repulsion boundary', rounded: [], boundary: 'repulsion' },
    { name: 'rounded gravity integration', rounded: ['gravity'] },
    { name: 'rounded repulsion integration', rounded: ['repulsion'] },
    { name: 'rounded gravity + repulsion integration', rounded: ['gravity', 'repulsion'] },
    { name: 'polar gravity + rounded repulsion integration', rounded: ['repulsion'], polar: true },
    { name: 'refined gravity trigonometry', rounded: [], polar: true, trig: true },
    { name: 'refined trigonometry + rounded gravity integration', rounded: ['gravity'], polar: true, trig: true },
  ]
  for (const variant of variants) {
    if (cancelled()) throw new Error('Tick isolation stopped')
    const backend = await createCombinedWebGPU(
      document.createElement('canvas'), graph, input, session.settings.springPrecision, {
        roundedStages: variant.rounded,
        polarGravity: variant.polar ?? (session.settings.springPrecision === 'aligned' || session.settings.springPrecision === 'trig'),
        refinedTrig: variant.trig ?? session.settings.springPrecision === 'trig',
      }
    )
    try {
      backend.setPositions(capture.input)
      let cpu = capture.input; let gpu = capture.input
      for (const stage of STAGES) {
        if (cancelled()) throw new Error('Tick isolation stopped')
        const expected = oracle.stage(stage, cpu, capture.alpha, capture.tick - 1)
        const local = variant.name === 'original' ? oracle.stage(stage, gpu, capture.alpha, capture.tick - 1) : undefined
        if (stage === 'repulsion') backend.setFrame(frameFor(gpu, capture.tick - 1))
        backend.stepStage(stage, capture.alpha)
        const actual = await backend.read()
        if (stage === 'gravity' && variant.trig && variant.rounded.includes('gravity')) {
          report.refinedGravity = await traceGravity(capture.input, capture.alpha, actual.forces, true)
        }
        if (local) {
          if (stage === 'gravity' && session.settings.springPrecision === 'aligned') {
            report.gravity = await traceGravity(capture.input, capture.alpha, actual.forces)
          }
          const compare = stage === 'incoming' || stage === 'outgoing' ? springCompare : compareArray
          report.stages.push({
            stage,
            localForce: compare(actual.forces, local.forces),
            localPosition: compare(actual.positions, local.positions),
            composedForce: compareArray(actual.forces, expected.forces),
            composedPosition: compareArray(actual.positions, expected.positions),
            points: points.map(point => ({
              point,
              cpu: Array.from(expected.positions.slice(point * 4, point * 4 + 2)),
              gpu: Array.from(actual.positions.slice(point * 4, point * 4 + 2)),
              cpuForce: Array.from(expected.forces.slice(point * 4, point * 4 + 2)),
              gpuForce: Array.from(actual.forces.slice(point * 4, point * 4 + 2)),
            })),
          })
        }
        cpu = expected.positions; gpu = actual.positions
        if (variant.boundary === stage) { gpu = cpu; backend.setPositions(cpu) }
      }
      if (variant.name === 'original') report.baselineMatchesCapture = sameBits(gpu, capture.actual) && sameBits(cpu, capture.expected)
      report.ablations.push({
        name: variant.name,
        kind: variant.boundary ? 'boundary' : 'kernel',
        positions: compareArray(gpu, capture.expected),
        components: components.map(c => gpu[c.point * 4 + c.axis]),
      })
    } finally { backend.destroy() }
  }
  if (!cancelled()) report.trigValidation = await validateGravityTrig()
  return report
}
