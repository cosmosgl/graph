import { Buffer } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { createDevice, readFloats, upload } from '../../gpu/luma'
import { createCenterWebGPU } from '../combined-layout/center-webgpu'
import { centerAggregate } from '../combined-layout/center-reference'
import { compareArray } from '../many-body/reference'

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('computes one resident center with the same forces through masks, boundaries and resize', async () => {
  const device = await createDevice('webgpu')
  const capacity = 65537
  const points = upload(device, new Float32Array(capacity * 4))
  const oldForces = device.createBuffer({ byteLength: capacity * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })
  const newForces = device.createBuffer({ byteLength: capacity * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })
  const variants: Array<Awaited<ReturnType<typeof createCenterWebGPU>>> = []
  try {
    for (const reduction of ['f32', 'high-low'] as const) {
      const existing = await createCenterWebGPU(device, 1, oldForces, () => reduction, 'linear')
      variants.push(existing)
      const once = await createCenterWebGPU(device, 1, newForces, () => reduction, 'linear', 'once')
      variants.push(once)
      for (const count of [1, 255, 256, 257, 4097, 65537, 4, 0, 4]) {
        existing.resize(count); once.resize(count)
        for (const fixture of ['offset', 'signed', 'masked', 'all-absent'] as const) {
          const input = new Float32Array(count * 4)
          for (let i = 0; i < count; i++) {
            input[i * 4] = (fixture === 'signed' && i % 2 ? -1 : 1) * (2048 + (i % 71) / 8192)
            input[i * 4 + 1] = (fixture === 'signed' && i % 3 ? -1 : 1) * (32768 + (i % 37) / 256)
            input[i * 4 + 2] = i % 7 === 0 ? 1 : 0
            if (fixture === 'all-absent' || (fixture === 'masked' && i % 3 === 0)) input.set([NaN, NaN, 0, 1], i * 4)
          }
          if (input.byteLength) points.write(input)
          if (count) {
            for (const center of [existing, once]) {
              const pass = device.beginComputePass()
              try { center.encode(pass, points, 0.7, 0.4) } finally { pass.end() }
              device.submit()
            }
          }
          const a = await existing.read(); const b = await once.read()
          const meanBytes = await once.resultBuffer().readAsync(16, 16)
          const mean = new Float32Array(meanBytes.buffer, meanBytes.byteOffset, 4).slice()
          const expectedCount = centerAggregate(input)[2]
          const label = `${reduction}/${count}/${fixture}`
          expect(Array.from(new Uint32Array(a.buffer)), label).toEqual(Array.from(new Uint32Array(b.buffer)))
          expect(b[2], label).toBe(expectedCount)
          expect(mean[2], label).toBe(expectedCount)
          if (!expectedCount) expect(Array.from(mean), label).toEqual([0, 0, 0, 0])
          else {
            const expected = new Float32Array([b[0] / b[2], b[1] / b[2], b[2], 0])
            expect(compareArray(mean, expected).valid, label).toBe(true)
          }
          if (count) {
            const left = await readFloats(oldForces, count * 16); const right = await readFloats(newForces, count * 16)
            expect(compareArray(right, left).valid, label).toBe(true)
          }
        }
      }
      existing.destroy(); once.destroy(); variants.length = 0
    }
  } finally { variants.forEach(center => center.destroy()); newForces.destroy(); oldForces.destroy(); points.destroy(); device.destroy() }
}, 120000)

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('reports the paired current and once-computed center checks', async () => {
  const { runOnceStudy } = await import('./center-once-study')
  const device = await createDevice('webgpu')
  try {
    const report = await runOnceStudy(device, 257, () => {}, () => false, { warmups: 1, samples: 3, operations: 2 })
    expect(report.countExact && report.aggregateBitsExact && report.forceComparison.valid).toBe(true)
    expect(report.timings).toHaveLength(2)
    expect(report.timings.every(timing => timing.pairs.length === 4)).toBe(true)
  } finally { device.destroy() }
}, 120000)

it.skipIf(!import.meta.env.LAB_CENTER_ONCE)('records the visible native once-center scale comparison', async () => {
  const { runOnceStudy, ONCE_POLICY } = await import('./center-once-study')
  const { writeArtifact } = await import('../../testing/artifacts')
  const device = await createDevice('webgpu')
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  const report: {
    sourceRevision: string; sourceSnapshot: string; browser: string; visibility: string; webgpu: unknown; webgl: unknown;
    timestampQuery: boolean; limits: unknown; luma: string; policy: typeof ONCE_POLICY; status: string; error: string;
    rows: Array<Awaited<ReturnType<typeof runOnceStudy>>>;
  } = {
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    webgpu: device.info,
    webgl: webgl.info,
    timestampQuery: device.features.has('timestamp-query'),
    limits: {
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxBufferSize: device.limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension,
    },
    luma: '10.0.0-alpha.15',
    policy: ONCE_POLICY,
    status: 'running',
    error: '',
    rows: [],
  }
  webgl.destroy()
  try {
    if (!report.sourceRevision || !report.sourceSnapshot) throw new Error('Source snapshot and revision are required')
    if (report.visibility !== 'visible' || navigator.userAgent.includes('HeadlessChrome') || device.info.fallback !== false) {
      throw new Error('Use a visible browser and non-fallback WebGPU adapter')
    }
    await writeArtifact('center-once', report)
    const counts = import.meta.env.LAB_SCALE_COUNT ? [import.meta.env.LAB_SCALE_COUNT] : [8192, 65536, 100000, 1000000, 2000000, 4194240]
    for (const count of counts) {
      report.rows.push(await runOnceStudy(device, count))
      await writeArtifact('center-once', report)
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally {
    await writeArtifact('center-once', report); device.destroy()
  }
  expect(report.error).toBe('')
  expect(report.status).toBe('complete')
  expect(report.rows.every(row => row.countExact && row.aggregateBitsExact && row.forceComparison.valid)).toBe(true)
}, 900000)
