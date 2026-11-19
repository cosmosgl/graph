import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { differingBits } from '../combined-layout/resident'
import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { median, type Measurement } from '../many-body/timing'
import type { Snapshot } from '../many-body/reference'
import { buildReference, frameFor } from './data'
import { centroidReference, centroidRounding, type CentroidMode } from './centroids'
import { farResources } from './far-resources'
import { gridReference, comparePresent } from './reference'
import { compareStructure } from './validation'
import { createGridWebGPU } from './webgpu'
import type { GridBackend } from './backend'

type Validation = {
  cpu: ReturnType<typeof comparePresent>; forceBits: number; positionBits: number;
  repeatForceBits: number; repeatPositionBits: number;
}
type Row = {
  name: string; count: number; fixture: string; bufferBytes: number; extraStorageBytes: number; extraDispatches: number;
  globalContributionsBytes: number; workgroupBytes: number; status: string; reason: string;
  structure: ReturnType<typeof compareStructure>; centroidDifferences: number; validations: Validation[]; samples: Measurement[];
  pilot: Measurement;
  summary: { gpuMs: number; minMs: number; maxMs: number; submitMs: number; strictCpuPass: boolean } | null;
}

it.skipIf(!import.meta.env.LAB_FAR_ALTERNATIVES)('compares direct and workgroup far-field alternatives', async () => {
  const canvas = document.createElement('canvas')
  const device = await createDevice('webgpu', canvas)
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  const limits = device.limits as unknown as Record<string, number>
  const report: {
    sourceRevision: string; sourceSnapshot: string; browser: string; visibility: string; device: unknown;
    webgl: unknown; limits: unknown; luma: string; policy: unknown; status: string; error: string; rows: Row[];
  } = {
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    device: device.info,
    webgl: webgl.info,
    limits: {
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
      maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
    },
    luma: '10.0.0-alpha.15',
    policy: { warmups: 3, samples: 7, operations: 1, order: 'rotate', workgroupPilotLimitMs: 1500 },
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
    await writeArtifact('repulsion-alternatives', report)
    for (const fixture of ['uniform', 'clusters'] as Fixture[]) {
      for (const count of [8192, 16384]) {
        const input = createFixture(fixture, count); const frame = frameFor(input.points, 0, 8, true)
        const expectedStructure = buildReference(input.points, frame)
        const expected = gridReference(input, input.points, PARAMETERS, frame, expectedStructure)
        const expectedCentroids = centroidReference(expectedStructure)
        const configs: Array<{ name: string; mode: CentroidMode; chunkSize?: number }> = [
          { name: 'streamed', mode: 'streamed' }, { name: 'chunk-4096', mode: 'chunked', chunkSize: 4096 },
          { name: 'direct', mode: 'refined' }, { name: 'workgroup', mode: 'workgroup' },
          { name: 'workgroup-local', mode: 'workgroup-local' },
        ]
        const backends: GridBackend[] = []; const ledgers = configs.map(() => new BufferLedger())
        const pilots: Snapshot[] = []; const rows: Row[] = []
        try {
          for (const [i, config] of configs.entries()) {
            backends.push(await createGridWebGPU(canvas, input, PARAMETERS, frame, config.mode, factory => factory, {
              context: { device, ledger: ledgers[i] }, aggregation: 'cached-small', nearArithmetic: 'refined', farChunkSize: config.chunkSize,
            }))
          }
          for (const [i, config] of configs.entries()) {
            const pilot = await backends[i].measure('step', 1); pilots.push(pilot.snapshot)
            const structure = await backends[i].readStructure(); const centroids = await backends[i].readCentroids!()
            const memory = farResources(count, config.mode, config.chunkSize)
            const validation: Validation = {
              cpu: comparePresent(pilot.snapshot, expected, input.points),
              forceBits: differingBits(pilot.snapshot.forces, pilots[0].forces),
              positionBits: differingBits(pilot.snapshot.positions, pilots[0].positions),
              repeatForceBits: 0,
              repeatPositionBits: 0,
            }
            const tooSlow = config.mode.startsWith('workgroup') && pilot.timing.batchCompletionMs > 1500
            rows.push({
              name: config.name,
              count,
              fixture,
              bufferBytes: ledgers[i].liveBytes,
              ...memory,
              globalContributionsBytes: config.mode === 'streamed'
                ? count * 100 * 8
                : config.mode === 'chunked' ? Math.min(count, config.chunkSize!) * 100 * 8 : 0,
              workgroupBytes: config.mode.startsWith('workgroup') ? 64 * 2 * 4 : 0,
              status: tooSlow ? 'pilot-only' : 'running',
              reason: tooSlow ? 'Pilot completion exceeded 1500 ms' : '',
              structure: compareStructure(structure, expectedStructure),
              centroidDifferences: centroidRounding(centroids, expectedCentroids).differingComponents,
              validations: [validation],
              pilot: pilot.timing,
              samples: [],
              summary: null,
            })
            report.rows.push(rows[i]); await writeArtifact('repulsion-alternatives', report)
          }
          for (let round = 0; round < 10; round++) {
            for (let order = 0; order < configs.length; order++) {
              const i = (round + order) % configs.length
              if (rows[i].status !== 'running') continue
              if (document.visibilityState !== 'visible') throw new Error('Keep the tab visible during timing')
              const result = await backends[i].measure('step', 1)
              if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during timing')
              rows[i].validations.push({
                cpu: comparePresent(result.snapshot, expected, input.points),
                forceBits: differingBits(result.snapshot.forces, pilots[0].forces),
                positionBits: differingBits(result.snapshot.positions, pilots[0].positions),
                repeatForceBits: differingBits(result.snapshot.forces, pilots[i].forces),
                repeatPositionBits: differingBits(result.snapshot.positions, pilots[i].positions),
              })
              if (round >= 3) rows[i].samples.push(result.timing)
            }
          }
          for (const row of rows) {
            if (row.status !== 'running') continue
            const stable = row.structure.valid && !row.centroidDifferences && row.validations.length === 11 &&
              row.validations.every(check => check.repeatForceBits === 0 && check.repeatPositionBits === 0)
            const timed = row.samples.length === 7 && row.samples.every(timing => timing.timerStatus === 'valid' &&
              timing.batchGpuMs !== null && Number.isFinite(timing.batchGpuMs) && timing.batchGpuMs > 0)
            if (stable && timed) {
              const gpu = row.samples.map(timing => timing.batchGpuMs!)
              row.summary = {
                gpuMs: median(gpu),
                minMs: Math.min(...gpu),
                maxMs: Math.max(...gpu),
                submitMs: median(row.samples.map(timing => timing.batchSubmitMs)),
                strictCpuPass: row.validations.every(check => check.cpu.valid),
              }
              row.status = 'complete'
            } else { row.status = 'invalid'; row.reason = 'Structure, centroids, repeatability or timestamps failed' }
          }
          await writeArtifact('repulsion-alternatives', report)
        } finally { backends.forEach(backend => backend.destroy()) }
        if (ledgers.some(ledger => ledger.liveBytes !== 0)) throw new Error('A comparison backend retained owned buffers')
      }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally {
    await writeArtifact('repulsion-alternatives', report); device.destroy()
  }
  expect(report.error).toBe('')
  expect(report.status).toBe('complete')
}, 900000)
