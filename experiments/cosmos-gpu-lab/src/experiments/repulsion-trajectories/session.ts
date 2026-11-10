import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { compareArray, type Snapshot } from '../many-body/reference'
import { createGridWebGL } from '../many-body-grid/webgl'
import { createGridWebGPU } from '../many-body-grid/webgpu'
import { buildReference, cellOf, frameFor, layout } from '../many-body-grid/data'
import { comparePresent, gridReference, integrate } from '../many-body-grid/reference'
import { compareStructure } from '../many-body-grid/validation'
import { centroidReference, centroidRounding } from '../many-body-grid/centroids'
import type { GridBackend } from '../many-body-grid/backend'
import { displacement, shape } from './metrics'
export const LANES = ['webgl', 'materialized', 'streamed'] as const
export type Lane = typeof LANES[number]
export const LABELS = { webgl: 'Production WebGL', materialized: 'WebGPU · full buffer', streamed: 'WebGPU · streamed', CPU: 'CPU reference' }
export type Settings = { fixture: Fixture; count: number; slots: number; precise: boolean }
export type TrajectoryCheck = {
  name: Lane; frame: { bounds: number[]; seed: number; slots: number; precise: boolean };
  output: ReturnType<typeof comparePresent>; structure: ReturnType<typeof compareStructure>;
  integration: ReturnType<typeof compareArray>; centroidDifferences: number | null; valid: boolean;
  drift: ReturnType<typeof displacement>; motion: ReturnType<typeof displacement>; shape: ReturnType<typeof shape>;
  cellDifferences: number;
}
export type TrajectoryRow = {
  tick: number; checks: TrajectoryCheck[]; cpu: { shape: ReturnType<typeof shape>; motion: ReturnType<typeof displacement> };
  correctedDrift: ReturnType<typeof displacement> | null; complete: boolean; errors: Partial<Record<Lane, string>>;
}
export async function createTrajectorySession (settings: Settings, canvas: (name: Lane) => HTMLCanvasElement): Promise<{
  input: ReturnType<typeof createFixture>; settings: Settings; rows: TrajectoryRow[];
  lanes: Array<{ name: Lane; backend: GridBackend; positions: Float32Array }>;
  errors: Partial<Record<Lane, string>>; firstFailures: Partial<Record<Lane, { tick: number; input: Float32Array; actual: Snapshot; expected: Snapshot }>>;
  cpu(): Float32Array; step(): Promise<TrajectoryRow>; destroy(): void;
}> {
  const input = createFixture(settings.fixture, settings.count)
  const normalized = { ...settings, count: input.points.length / 4 }
  let cpu = input.points; let destroyed = false; let busy = false
  const lanes: Array<{ name: Lane; backend: GridBackend; positions: Float32Array }> = []
  const rows: TrajectoryRow[] = []; const errors: Partial<Record<Lane, string>> = {}
  const firstFailures: Partial<Record<Lane, { tick: number; input: Float32Array; actual: Snapshot; expected: Snapshot }>> = {}
  const frame = frameFor(cpu, 0, settings.slots, settings.precise)
  for (const name of LANES) {
    try {
      const backend = name === 'webgl'
        ? await createGridWebGL(canvas(name), input, PARAMETERS, frame)
        : await createGridWebGPU(canvas(name), input, PARAMETERS, frame, name)
      lanes.push({ name, backend, positions: cpu })
    } catch (error) { errors[name] = error instanceof Error ? error.message : String(error) }
  }
  return {
    input,
    settings: normalized,
    rows,
    lanes,
    errors,
    firstFailures,
    cpu: () => cpu,
    async step (): Promise<TrajectoryRow> {
      if (destroyed || busy) throw new Error('Trajectory session is unavailable or already stepping')
      busy = true
      try {
        const tick = rows.length
        const cpuPrevious = cpu; const cpuFrame = frameFor(cpu, tick, settings.slots, settings.precise)
        const cpuExpected = gridReference(input, cpu, PARAMETERS, cpuFrame, buildReference(cpu, cpuFrame))
        const checks: TrajectoryCheck[] = []
        for (const lane of lanes) {
          if (destroyed) throw new Error('Trajectory session disposed')
          if (errors[lane.name]) continue
          await new Promise(resolve => setTimeout(resolve, 0))
          if (destroyed) throw new Error('Trajectory session disposed')
          const previous = lane.positions
          const ownFrame = frameFor(previous, tick, settings.slots, settings.precise)
          const expectedStructure = buildReference(previous, ownFrame)
          const expected = gridReference(input, previous, PARAMETERS, ownFrame, expectedStructure)
          try {
            // Positions stay resident. Never reset a GPU path to CPU or another backend's output.
            lane.backend.setFrame(ownFrame); lane.backend.step()
            const actual = await lane.backend.read(); const structure = await lane.backend.readStructure()
            if (destroyed) throw new Error('Trajectory session disposed')
            const output = comparePresent(actual, expected, previous)
            const structural = compareStructure(structure, expectedStructure)
            const integration = compareArray(actual.positions, integrate(previous, actual.forces, PARAMETERS), previous)
            const centroidDifferences = lane.name === 'webgl'
              ? null
              : centroidRounding(await lane.backend.readCentroids!(), centroidReference(structure)).differingComponents
            const valid = output.valid && structural.valid && integration.valid && (centroidDifferences === null || centroidDifferences === 0)
            if (!valid && !firstFailures[lane.name]) firstFailures[lane.name] = { tick: tick + 1, input: previous.slice(), actual, expected }
            let cellDifferences = 0; const finest = layout(normalized.count).finest
            for (let i = 0; i < previous.length; i += 4) {
              if (previous[i + 3] <= 0.5 && cellOf(previous[i], previous[i + 1], finest, ownFrame.bounds) !==
                cellOf(cpuPrevious[i], cpuPrevious[i + 1], finest, cpuFrame.bounds)) cellDifferences++
            }
            const nextShape = shape(actual.positions)
            checks.push({
              name: lane.name,
              frame: { ...ownFrame, bounds: Array.from(ownFrame.bounds) },
              output,
              structure: structural,
              integration,
              centroidDifferences,
              valid,
              drift: displacement(actual.positions, cpuExpected.positions),
              motion: displacement(actual.positions, previous),
              shape: nextShape,
              cellDifferences,
            })
            lane.positions = actual.positions
            if (!nextShape.finite) errors[lane.name] = 'Non-finite present positions; this path stopped'
          } catch (error) { errors[lane.name] = error instanceof Error ? error.message : String(error) }
        }
        if (destroyed) throw new Error('Trajectory session disposed')
        const full = lanes.find(l => l.name === 'materialized'); const streamed = lanes.find(l => l.name === 'streamed')
        cpu = cpuExpected.positions
        const row: TrajectoryRow = {
          tick: tick + 1,
          checks,
          cpu: { shape: shape(cpu), motion: displacement(cpu, cpuPrevious) },
          correctedDrift: full && streamed && !errors.materialized && !errors.streamed ? displacement(full.positions, streamed.positions) : null,
          complete: checks.length === LANES.length && !Object.keys(errors).length,
          errors: { ...errors },
        }
        rows.push(row); return row
      } finally { busy = false }
    },
    destroy (): void { destroyed = true; lanes.forEach(lane => lane.backend.destroy()) },
  }
}
export type TrajectorySession = Awaited<ReturnType<typeof createTrajectorySession>>
