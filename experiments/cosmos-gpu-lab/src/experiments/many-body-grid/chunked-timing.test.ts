import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { differingBits } from '../combined-layout/resident'
import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { median, type Measurement } from '../many-body/timing'
import { buildReference, frameFor } from './data'
import { centroidReference, centroidRounding, type CentroidMode } from './centroids'
import { farResources } from './far-resources'
import { gridReference, comparePresent } from './reference'
import { compareStructure } from './validation'
import { createGridWebGPU } from './webgpu'
import type { GridBackend } from './backend'

it.skipIf(!import.meta.env.LAB_REPULSION_CHUNK)('compares bounded scratch with the existing full streamed buffer', async () => {
  const canvas = document.createElement('canvas')
  const device = await createDevice('webgpu', canvas)
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  const report: {
    sourceRevision: string; sourceSnapshot: string; browser: string; visibility: string; device: unknown;
    webgl: unknown; limits: unknown; luma: string; policy: unknown; status: string; error: string; rows: unknown[];
  } = {
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    device: device.info,
    webgl: webgl.info,
    limits: { maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize, maxBufferSize: device.limits.maxBufferSize },
    luma: '10.0.0-alpha.15',
    policy: { warmups: 3, samples: 7, operations: 1, order: 'rotate' },
    status: 'running',
    error: '',
    rows: [],
  }
  webgl.destroy()
  try {
    if (!report.sourceRevision || !report.sourceSnapshot) throw new Error('Source snapshot and revision are required')
    if (report.visibility !== 'visible' || navigator.userAgent.includes('HeadlessChrome') || device.info.fallback !== false) {
      throw new Error('The timed study requires a visible browser and non-fallback WebGPU adapter')
    }
    await writeArtifact('repulsion-chunks', report)
    for (const fixture of ['uniform', 'clusters'] as Fixture[]) {
      const counts = import.meta.env.LAB_SCALE_COUNT ? [import.meta.env.LAB_SCALE_COUNT] : [8192, 16384]
      for (const count of counts) {
        if (count > 16384) throw new Error('This correctness benchmark is bounded at 16,384 points')
        const input = createFixture(fixture, count); const frame = frameFor(input.points, 0, 8, true)
        const expectedStructure = buildReference(input.points, frame)
        const expected = gridReference(input, input.points, PARAMETERS, frame, expectedStructure)
        const configs: Array<{ name: string; mode: CentroidMode; chunkSize?: number }> = [
          { name: 'streamed', mode: 'streamed' },
          { name: 'chunk-1024', mode: 'chunked', chunkSize: 1024 },
          { name: 'chunk-4096', mode: 'chunked', chunkSize: 4096 },
          { name: 'chunk-8192', mode: 'chunked', chunkSize: 8192 },
          { name: 'chunk-16384', mode: 'chunked', chunkSize: 16384 },
        ]
        const backends: GridBackend[] = []; const ledgers = configs.map(() => new BufferLedger())
        const rows: Array<{
          name: string; count: number; fixture: string; chunkSize?: number; bufferBytes: number; extraStorageBytes: number; extraDispatches: number;
          structure: ReturnType<typeof compareStructure>; centroidDifferences: number; validations: Array<{
            valid: boolean; forceBits: number; positionBits: number;
          }>; samples: Measurement[]; summary: { gpuMs: number; minMs: number; maxMs: number; submitMs: number } | null;
        }> = []
        try {
          for (const [i, config] of configs.entries()) {
            backends.push(await createGridWebGPU(canvas, input, PARAMETERS, frame, config.mode, factory => factory, {
              context: { device, ledger: ledgers[i] }, aggregation: 'cached-small', farChunkSize: config.chunkSize,
            }))
          }
          const baseline = await backends[0].measure('step', 1)
          for (const [i, config] of configs.entries()) {
            const pilot = i === 0 ? baseline : await backends[i].measure('step', 1)
            const structure = await backends[i].readStructure()
            const centroids = await backends[i].readCentroids!()
            const memory = farResources(count, config.mode, config.chunkSize)
            rows.push({
              name: config.name,
              count,
              fixture,
              chunkSize: config.chunkSize,
              bufferBytes: ledgers[i].liveBytes,
              ...memory,
              structure: compareStructure(structure, expectedStructure),
              centroidDifferences: centroidRounding(centroids, centroidReference(expectedStructure)).differingComponents,
              validations: [{
                valid: comparePresent(pilot.snapshot, expected, input.points).valid,
                forceBits: differingBits(pilot.snapshot.forces, baseline.snapshot.forces),
                positionBits: differingBits(pilot.snapshot.positions, baseline.snapshot.positions),
              }],
              samples: [],
              summary: null,
            })
          }
          for (let round = 0; round < 10; round++) {
            for (let order = 0; order < configs.length; order++) {
              const i = (round + order) % configs.length
              if (document.visibilityState !== 'visible') throw new Error('Keep the tab visible during timing')
              const result = await backends[i].measure('step', 1)
              if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during timing')
              const validation = comparePresent(result.snapshot, expected, input.points)
              rows[i].validations.push({
                valid: validation.valid,
                forceBits: differingBits(result.snapshot.forces, baseline.snapshot.forces),
                positionBits: differingBits(result.snapshot.positions, baseline.snapshot.positions),
              })
              if (round >= 3) rows[i].samples.push(result.timing)
            }
          }
          for (const row of rows) {
            const valid = row.structure.valid && !row.centroidDifferences && row.validations.length === 11 &&
              row.validations.every(check => check.valid && check.forceBits === 0 && check.positionBits === 0) &&
              row.samples.length === 7 && row.samples.every(timing => timing.timerStatus === 'valid' &&
                timing.batchGpuMs !== null && Number.isFinite(timing.batchGpuMs) && timing.batchGpuMs > 0)
            if (valid) {
              const gpu = row.samples.map(timing => timing.batchGpuMs!)
              row.summary = {
                gpuMs: median(gpu),
                minMs: Math.min(...gpu),
                maxMs: Math.max(...gpu),
                submitMs: median(row.samples.map(timing => timing.batchSubmitMs)),
              }
            }
          }
          report.rows.push(...rows)
          await writeArtifact('repulsion-chunks', report)
        } finally { backends.forEach(backend => backend.destroy()) }
        if (ledgers.some(ledger => ledger.liveBytes !== 0)) throw new Error('A comparison backend retained owned buffers')
      }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally {
    await writeArtifact('repulsion-chunks', report); device.destroy()
  }
  expect(report.error).toBe('')
  expect(report.status).toBe('complete')
}, 900000)
