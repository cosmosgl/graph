import type { Input, Parameters } from '../many-body/data'
import { compareArray, type Snapshot } from '../many-body/reference'
import { createGridWebGPU } from './webgpu'
import { buildReference, type Frame } from './data'
import { comparePresent, gridReference } from './reference'
import { compareStructure } from './validation'
import { centroidReference, centroidRounding } from './centroids'
import { createTrace, traceChecks } from './trace'
export type CentroidComparison = {
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
export async function compareCentroidPass (
  input: Input, points: Float32Array, p: Parameters, frame: Frame, inline: Snapshot
): Promise<CentroidComparison> {
  const expectedStructure = buildReference(points, frame)
  const expected = gridReference(input, points, p, frame, expectedStructure)
  const backend = await createGridWebGPU(document.createElement('canvas'), { ...input, points }, p, frame, 'stored')
  try {
    backend.step()
    const actual = await backend.read(); const structure = await backend.readStructure()
    if (!backend.readCentroids || !backend.diagnose) throw new Error('Stored centroid diagnostics unavailable')
    const centers = await backend.readCentroids()
    const replay = await backend.diagnose()
    const expectedTrace = createTrace(points.length / 4)
    const local = gridReference(input, points, p, frame, structure, expectedTrace)
    const centroidCheck = compareArray(centers, centroidReference(structure))
    const stored = comparePresent(actual, expected, points)
    const structural = compareStructure(structure, expectedStructure)
    const replayCheck = comparePresent({ ...actual, forces: replay.forces }, actual, points)
    return {
      inline: comparePresent(inline, expected, points),
      stored,
      sameCentroids: comparePresent(actual, gridReference(input, points, p, frame, structure, undefined, 'rounded', centers), points),
      structural,
      replay: replayCheck,
      versusInline: comparePresent(actual, inline, points),
      centroids: centroidRounding(centers, centroidReference(structure)),
      centroidCheck,
      stages: traceChecks({ ...replay.trace, final: actual.forces, positions: actual.positions },
        { ...expectedTrace, final: local.forces, positions: local.positions }, points),
      storedPassed: stored.valid && structural.valid && replayCheck.valid && centroidCheck.valid,
      extraStorageBytes: centers.byteLength,
      extraDispatches: 1,
      device: backend.info,
    }
  } finally { backend.destroy() }
}
