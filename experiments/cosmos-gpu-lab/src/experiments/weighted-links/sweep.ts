import { buildTopology, createFixture, PARAMETERS, type GraphInput, type Parameters } from './data'
import { compare, createReferenceIndex, referenceTick } from './reference'
import type { LinkBackend, Measurement, SetupSubmission, Stage } from './backend'
import { chooseOperations, STAGES, TIMING_POLICY } from './timing'

export const SWEEP_COUNTS = [1000, 10000, 50000, 100000] as const
export const SWEEP_SHAPES = ['chain', 'star', 'clusters', 'hubs'] as const
export type SweepShape = typeof SWEEP_SHAPES[number]
export type SweepCase = { count: number; shape: SweepShape }
export function createSweepPlan (large = true): SweepCase[] {
  return SWEEP_COUNTS.filter(n => large || n <= 10000).flatMap((count, round) =>
    // Deterministic alternating order; run the largest single hub last so a device failure retains other cases.
    (count === 100000
      ? ['hubs', 'clusters', 'chain', 'star'] as SweepShape[]
      : round % 2 ? [...SWEEP_SHAPES].reverse() : [...SWEEP_SHAPES]).map(shape => ({ count, shape })))
}
export function createSweepGraph ({ count, shape }: SweepCase): GraphInput {
  const graph = createFixture('chain', count)
  // Identical positions, weights and E = V - 1. Only endpoints/degree distribution change.
  for (let i = 1; i < count; i++) {
    let a = i - 1; let b = i
    if (shape === 'star') a = 0
    if (shape === 'hubs') a = i <= 4 ? i - 1 : i % 4
    if (shape === 'clusters') {
      a = Math.floor(i / 32) * 32
      // Reuse an intra-cluster edge at boundaries to match E without joining components.
      if (a === i) b = i + 1 < count ? i + 1 : i
    }
    graph.links.set([a, b], (i - 1) * 2)
  }
  return graph
}
export type ValidationCheck = { tick: number; backend: string; valid: boolean; failures: number; maxError: number }
export type TimingRow = { backend: string; stage: Stage; operations: number; samples: Measurement[] }
export type SweepRow = SweepCase & {
  links: number; maxDegree: number; topologyBuildMs: number[];
  setup: Array<SetupSubmission & { backend: string; completionMs: number }>;
  validation: ValidationCheck[]; timings: TimingRow[];
  status: 'passed' | 'failed' | 'cancelled' | 'error'; error?: string; errorPhase?: string;
}
export const yieldBrowser = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }
export async function validateTrajectory (
  backends: LinkBackend[], graph: GraphInput, parameters: Parameters, cancelled: () => boolean, progress: (text: string) => void,
  ticks = TIMING_POLICY.trajectoryTicks, checks: ValidationCheck[] = []
): Promise<ValidationCheck[]> {
  const index = createReferenceIndex(graph)
  let cpu = graph.points
  backends.forEach(b => b.reset())
  for (let tick = 1; tick <= ticks; tick++) {
    if (cancelled()) return checks
    const expected = referenceTick(graph, cpu, parameters, index)
    // Keep validation submissions bounded; this work is deliberately outside all timings.
    for (const backend of backends) {
      progress(`Validating ${backend.name} · tick ${tick}/${ticks}`)
      backend.step(false)
      await backend.synchronize()
    }
    cpu = expected.positions
    if (tick === 1 || tick === 10 || tick === ticks) {
      const outputs = await Promise.all(backends.map(b => b.read()))
      outputs.forEach((output, i) => checks.push({ tick, backend: backends[i].name, ...compare(output, expected) }))
      if (outputs.length === 2) checks.push({ tick, backend: 'WebGL ↔ WebGPU', ...compare(outputs[0], outputs[1]) })
      progress(`Validating all points · tick ${tick}/${ticks}`)
      if (checks.some(check => !check.valid)) return checks
    }
    await yieldBrowser()
  }
  return checks
}
export async function measureStages (
  backends: LinkBackend[], cancelled: () => boolean, progress: (text: string) => void, rows: TimingRow[], reverseOrder = false
): Promise<void> {
  for (const stage of STAGES) {
    if (cancelled()) return
    // Calibration is a warmup too. One shared batch size keeps both backends' workloads equal.
    const calibration: Measurement[] = []
    for (const backend of backends) {
      if (cancelled()) return
      progress(`Calibrating ${backend.name} ${stage}`)
      calibration.push(await backend.measure(stage))
    }
    const operations = chooseOperations(calibration)
    const samples = new Map(backends.map(backend => [backend.name, [] as Measurement[]]))
    for (let i = 0; i < TIMING_POLICY.warmups + TIMING_POLICY.samples; i++) {
      const order = Boolean(i % 2) !== reverseOrder ? [...backends].reverse() : backends
      for (const backend of order) {
        if (cancelled()) return
        progress(`${backend.name} ${stage} · ${operations} operations · sample ${Math.max(0, i - TIMING_POLICY.warmups + 1)}/${TIMING_POLICY.samples}`)
        const sample = await backend.measure(stage, operations)
        if (i >= TIMING_POLICY.warmups) samples.get(backend.name)!.push(sample)
        await yieldBrowser()
      }
    }
    for (const backend of backends) rows.push({ backend: backend.name, stage, operations, samples: samples.get(backend.name)! })
  }
}
export async function runSweep (
  backends: LinkBackend[], plan: SweepCase[], cancelled: () => boolean, progress: (text: string) => void,
  rows: SweepRow[], parameters: Parameters = PARAMETERS
): Promise<void> {
  if (!backends.length) throw new Error('No backend selected')
  for (const [caseIndex, item] of plan.entries()) {
    if (cancelled()) return
    let phase = 'Building topology'
    const report = (text: string): void => {
      phase = text
      progress(`${caseIndex + 1}/${plan.length} · ${item.shape} · ${item.count.toLocaleString()} points · ${text}`)
    }
    report('Building topology')
    await yieldBrowser()
    const graph = createSweepGraph(item)
    const topologyBuildMs: number[] = []
    let topology = buildTopology(graph)
    for (let i = 0; i < TIMING_POLICY.warmups + TIMING_POLICY.samples; i++) {
      topology = buildTopology(graph)
      if (i >= TIMING_POLICY.warmups) topologyBuildMs.push(topology.buildMs)
    }
    const row: SweepRow = {
      ...item,
      links: topology.links.length / 2,
      maxDegree: topology.maxDegree,
      topologyBuildMs,
      setup: [],
      validation: [],
      timings: [],
      status: 'cancelled',
    }
    rows.push(row)
    try {
      for (const backend of caseIndex % 2 ? [...backends].reverse() : backends) {
        if (cancelled()) return
        report(`Setting up ${backend.name}`)
        const started = performance.now()
        const submission = backend.setGraph(graph, topology, parameters)
        await backend.synchronize()
        row.setup.push({ backend: backend.name, ...submission, completionMs: performance.now() - started })
      }
      row.validation = await validateTrajectory(backends, graph, parameters, cancelled, report)
      if (cancelled()) return
      if (row.validation.some(check => !check.valid)) { row.status = 'failed'; continue }
      await measureStages(backends, cancelled, report, row.timings, Boolean(caseIndex % 2))
      if (cancelled()) return
      row.status = 'passed'
    } catch (error) {
      row.status = 'error'; row.errorPhase = phase; row.error = error instanceof Error ? error.message : String(error)
      // Device/context failures invalidate later cases too; preserve completed rows for export.
      throw error
    }
    await yieldBrowser()
  }
}
