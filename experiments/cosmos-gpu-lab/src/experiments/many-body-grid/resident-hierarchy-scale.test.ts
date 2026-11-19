import { Buffer } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { createDevice, readFloats, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { differingBits } from '../combined-layout/resident'
import { createFixture, PARAMETERS } from '../many-body/data'
import { compareArray } from '../many-body/reference'
import { centroidReference } from './centroids'
import { buildReference, cellOf, frameSamples, layout } from './data'
import { gridReference } from './reference'
import { compareStructure } from './validation'
import { createResidentHierarchy } from './resident-hierarchy'

it.skipIf(!import.meta.env.LAB_RESIDENT_HIERARCHY_SCALE)('checks a large GPU hierarchy against the scalar reference', async () => {
  const count = import.meta.env.LAB_SCALE_COUNT || 1000000
  const report: {
    count: number; sourceRevision: string; sourceSnapshot: string; device?: unknown; status: string; phase: string; error?: string;
    structure?: ReturnType<typeof compareStructure>; countMismatches?: number; indexMismatches?: number;
    duplicateIndices?: number; missingIndices?: number; cpuForce?: ReturnType<typeof compareArray>; finite?: boolean;
    replay?: {
      aggregateComponents: number; slotComponents: number; forceComponents: number;
      aggregateStrict: ReturnType<typeof compareArray>; forceStrict: ReturnType<typeof compareArray>; forceRelativeL2Percent: number;
    };
  } = {
    count,
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    status: 'running',
    phase: 'setup',
  }
  const scope = resourceScope(); const own = scope.own
  let device: Awaited<ReturnType<typeof createDevice>> | undefined
  try {
    if (!report.sourceRevision || !report.sourceSnapshot) throw new Error('Source revision and snapshot are required')
    if (document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) throw new Error('A visible browser is required')
    await writeArtifact('resident-hierarchy-scale', report)
    const input = createFixture('uniform', count); input.points[2] = 1; input.points[7] = 1
    device = await createDevice('webgpu'); report.device = device.info
    const positions = own(upload(device, input.points)); const samples = own(upload(device, input.samples))
    const forces = own(device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const grid = own(await createResidentHierarchy(device, [positions], samples, forces, count, PARAMETERS))
    const execute = async (): Promise<void> => {
      grid.prepare(0, PARAMETERS.alpha); grid.encodeIndex(0)
      const pass = device!.beginComputePass(); try { grid.encodeForce(pass, 0) } finally { pass.end() }
      device!.submit(); await waitForGpu(device!, 30000)
    }
    report.phase = 'first GPU build'; await writeArtifact('resident-hierarchy-scale', report)
    await execute()
    const [box, actual, index, output] = await Promise.all([grid.readBounds(), grid.readStructure(), grid.readIndex(), readFloats(forces)])
    const frame = { bounds: box, slots: 8, precise: false, seed: frameSamples(0).seed }
    report.phase = 'CPU reference'; await writeArtifact('resident-hierarchy-scale', report)
    const reference = buildReference(input.points, frame); report.structure = compareStructure(actual, reference)
    let countMismatches = 0
    for (let i = 2; i < actual.aggregates.length; i += 4) if (actual.aggregates[i] !== reference.aggregates[i]) countMismatches++
    report.countMismatches = countMismatches
    const n = layout(count).finest; const seen = new Uint8Array(count); let indexMismatches = 0; let duplicateIndices = 0
    for (let cell = 0; cell < n * n; cell++) {
      for (let cursor = index.offsets[cell]; cursor < index.offsets[cell + 1]; cursor++) {
        const i = index.pointIndices[cursor]
        if (i >= count) { indexMismatches++; continue }
        if (seen[i]++) duplicateIndices++
        const expected = input.points[i * 4 + 3] > 0.5 ? 0 : cellOf(input.points[i * 4], input.points[i * 4 + 1], n, box)
        if (cell !== expected) indexMismatches++
      }
    }
    report.indexMismatches = indexMismatches; report.duplicateIndices = duplicateIndices
    report.missingIndices = seen.reduce((sum, value) => sum + (value === 0 ? 1 : 0), 0)
    const targets = Array.from({ length: Math.min(512, count) }, (_, i) => Math.floor(i * count / Math.min(512, count)))
    targets.push(1)
    const expected = gridReference(input, input.points, PARAMETERS, frame, actual, undefined, 'rounded', centroidReference(actual), targets)
    const select = (data: Float32Array): Float32Array => {
      const result = new Float32Array(targets.length * 4)
      targets.forEach((target, i) => result.set(data.subarray(target * 4, target * 4 + 4), i * 4))
      return result
    }
    report.cpuForce = compareArray(select(output), select(expected.forces)); report.finite = output.every(Number.isFinite)
    report.phase = 'GPU replay'; await writeArtifact('resident-hierarchy-scale', report)
    await execute()
    const [again, repeated] = await Promise.all([grid.readStructure(), readFloats(forces)])
    let squaredError = 0; let squaredForce = 0
    for (const [i, element] of output.entries()) { squaredError += (element - repeated[i]) ** 2; squaredForce += element ** 2 }
    report.replay = {
      aggregateComponents: differingBits(actual.aggregates, again.aggregates),
      slotComponents: differingBits(actual.slots, again.slots),
      forceComponents: differingBits(output, repeated),
      aggregateStrict: compareArray(again.aggregates, actual.aggregates),
      forceStrict: compareArray(repeated, output),
      forceRelativeL2Percent: squaredForce ? 100 * Math.sqrt(squaredError / squaredForce) : 0,
    }
    if (countMismatches || indexMismatches || duplicateIndices || report.missingIndices || report.structure.slotMismatches || !report.finite) {
      throw new Error('Large hierarchy failed its structural or finite-output checks')
    }
    report.status = 'complete'; report.phase = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally {
    await writeArtifact('resident-hierarchy-scale', report); scope.destroy(); device?.destroy()
  }
  expect(report.status, report.error).toBe('complete')
}, 900000)
