import type { Input, Parameters } from '../many-body/data'
import { compareArray, type Snapshot } from '../many-body/reference'
import { compareContributions, type ContributionReport } from './contributions'
import type { DivisionCheck } from './division-check'
import { farResources } from './far-resources'
import { createGridWebGPU } from './webgpu'
import { buildReference, type Frame } from './data'
import { comparePresent, gridReference } from './reference'
import { compareStructure } from './validation'
import { centroidReference, centroidRounding } from './centroids'
import { createTrace, traceChecks } from './trace'
export type CentroidEvaluation = {
  contributions?: ContributionReport;
  division?: DivisionCheck;
  inline: ReturnType<typeof comparePresent>;
  stored: ReturnType<typeof comparePresent>;
  sameCentroids: ReturnType<typeof comparePresent>;
  structural: ReturnType<typeof compareStructure>;
  replay: ReturnType<typeof comparePresent>;
  versusInline: ReturnType<typeof comparePresent>;
  centroids: ReturnType<typeof centroidRounding>;
  centroidCheck: ReturnType<typeof compareArray>;
  stages: ReturnType<typeof traceChecks>;
  storedPassed: boolean; extraStorageBytes: number; extraDispatches: number; device: string;
}
async function evaluateCentroidPass (
  input: Input, points: Float32Array, p: Parameters, frame: Frame, inline: Snapshot, mode: 'stored' | 'corrected' | 'materialized' | 'refined' | 'streamed'
): Promise<CentroidEvaluation> {
  const expectedStructure = buildReference(points, frame)
  const expected = gridReference(input, points, p, frame, expectedStructure)
  const backend = await createGridWebGPU(document.createElement('canvas'), { ...input, points }, p, frame, mode)
  try {
    backend.step()
    const actual = await backend.read(); const structure = await backend.readStructure()
    if (!backend.readCentroids || !backend.diagnose) throw new Error('Stored centroid diagnostics unavailable')
    const centers = await backend.readCentroids()
    const division = await backend.verifyDivision?.()
    const replay = await backend.diagnose()
    const expectedTrace = createTrace(points.length / 4)
    const local = gridReference(input, points, p, frame, structure, expectedTrace)
    const centroidCheck = compareArray(centers, centroidReference(structure))
    const stored = comparePresent(actual, expected, points)
    const structural = compareStructure(structure, expectedStructure)
    const replayCheck = comparePresent({ ...actual, forces: replay.forces }, actual, points)
    const stages = traceChecks({ ...replay.trace, final: actual.forces, positions: actual.positions },
      { ...expectedTrace, final: local.forces, positions: local.positions }, points)
    const target = stages.find(s => s.stage === 'far 128')?.worst?.point
    const detail = (mode === 'corrected' || mode === 'refined') && target !== undefined ? await backend.readContributions?.(target) : undefined
    const contributions = detail && target !== undefined
      ? compareContributions(detail.data, target, points, p, frame, structure, centers, detail.forces, actual.forces)
      : undefined
    return {
      contributions,
      division,
      inline: comparePresent(inline, expected, points),
      stored,
      sameCentroids: comparePresent(actual, gridReference(input, points, p, frame, structure, undefined, 'rounded', centers), points),
      structural,
      replay: replayCheck,
      versusInline: comparePresent(actual, inline, points),
      centroids: centroidRounding(centers, centroidReference(structure)),
      centroidCheck,
      stages,
      storedPassed: stored.valid && structural.valid && replayCheck.valid && centroidCheck.valid && (!contributions || contributions.replay.valid) &&
        (mode === 'stored' || (division?.mismatches === 0 && centroidRounding(centers, centroidReference(structure)).differingComponents === 0)),
      ...farResources(points.length / 4, mode),
      device: backend.info,
    }
  } finally { backend.destroy() }
}

export type CentroidComparison = CentroidEvaluation & {
  corrected: CentroidEvaluation; materialized: CentroidEvaluation; refined: CentroidEvaluation; streamed: CentroidEvaluation;
}
export async function compareCentroidPass (
  input: Input, points: Float32Array, p: Parameters, frame: Frame, inline: Snapshot
): Promise<CentroidComparison> {
  const stored = await evaluateCentroidPass(input, points, p, frame, inline, 'stored')
  const corrected = await evaluateCentroidPass(input, points, p, frame, inline, 'corrected')
  const materialized = await evaluateCentroidPass(input, points, p, frame, inline, 'materialized')
  const refined = await evaluateCentroidPass(input, points, p, frame, inline, 'refined')
  const streamed = await evaluateCentroidPass(input, points, p, frame, inline, 'streamed')
  return { ...stored, corrected, materialized, refined, streamed }
}
