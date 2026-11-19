import { expect, it } from 'vitest'
import { createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { measureBatch, summarize, timestamps, type Measurement } from '../many-body/timing'
import { createGridPositions, createCpuGridReference, validateGrid, type PointDistribution } from '../spatial-grid/reference'
import { createSpatialGridResources } from '../spatial-grid/resources'

it.skipIf(!import.meta.env.LAB_REPULSION_CSR)('tests the existing spatial-index primitive at one million points', async () => {
  const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  const report: {
    sourceRevision: string; sourceSnapshot: string; browser: string; visibility: string; device: unknown; webgl: unknown;
    limits: unknown; luma: string; policy: unknown; status: string; error: string; rows: unknown[];
  } = {
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    device: device.info,
    webgl: webgl.info,
    limits: { maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize, maxBufferSize: device.limits.maxBufferSize },
    luma: '10.0.0-alpha.15',
    policy: { warmups: 3, samples: 7, operations: 1, gpuInterval: 'count, scan, cursor copy, scatter; clear excluded' },
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
    await writeArtifact('repulsion-csr', report)
    const count = 1000000; const size = 512
    for (const distribution of ['uniform', 'clusters'] as PointDistribution[]) {
      const points = createGridPositions(count, distribution); const expected = createCpuGridReference(points, size)
      const scope = resourceScope()
      try {
        const positions = scope.own(upload(device, points))
        const grid = scope.own(createSpatialGridResources(device, [positions], count, size))
        await grid.build()
        const initial = await grid.readback()
        const initialValidation = validateGrid(points, size, expected, initial.counts, initial.offsets, initial.pointIndices)
        const samples: Measurement[] = []
        for (let round = 0; round < 10; round++) {
          if (document.visibilityState !== 'visible') throw new Error('Keep the tab visible during timing')
          const measurement = await measureBatch(device, 1, (query, first, last) => {
            grid.encodeBuild(device.commandEncoder, 0, timestamps(query, first, last))
          })
          if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during timing')
          if (round >= 3) samples.push(measurement)
        }
        const final = await grid.readback()
        const finalValidation = validateGrid(points, size, expected, final.counts, final.offsets, final.pointIndices)
        const valid = initialValidation.valid && finalValidation.valid && samples.length === 7 &&
          samples.every(value => value.timerStatus === 'valid' && value.batchGpuMs !== null && value.batchGpuMs > 0)
        report.rows.push({
          count,
          gridSize: size,
          distribution,
          occupiedCells: expected.occupiedCells,
          maximumCellLoad: expected.maximumCellLoad,
          positionBytes: grid.positionBytes,
          gridBytes: grid.gridBytes,
          initialValidation,
          finalValidation,
          samples,
          summary: valid ? summarize(samples) : null,
        })
        await writeArtifact('repulsion-csr', report)
      } finally { scope.destroy() }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally {
    await writeArtifact('repulsion-csr', report); device.destroy()
  }
  expect(report.error).toBe('')
  expect(report.status).toBe('complete')
}, 900000)
