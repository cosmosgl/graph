import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { writeArtifact } from '../../testing/artifacts'
import { createScaleInput, runScaleCount, scaleLimit, type CenterScaleResult } from './scale-study'

it('creates the same float32 fixture and reference each time', () => {
  const first = createScaleInput(257); const second = createScaleInput(257)
  expect(first.points).toEqual(second.points)
  expect(first.xy[0]).toBe(first.points[0])
  expect(first.points[2]).toBe(1)
  expect(first.center).toEqual(second.center)
})

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('runs both center-force variants on the same points', async () => {
  const device = await createDevice('webgpu')
  try {
    const result = await runScaleCount(device, 257)
    const candidate = result.webgpu.find(value => value.variant === 'high-low')!
    expect(candidate.countExact).toBe(true)
    expect(candidate.aggregateBitsExact).toBe(true)
    expect(candidate.sampledForceCheck.valid).toBe(true)
    expect(result.linearForce.sampledForceCheck.valid).toBe(true)
    expect(result.linearForce.comparisonToCurrent.valid).toBe(true)
    expect('center' in result.webgl && result.webgl.countExact).toBe(true)
  } finally { device.destroy() }
}, 120000)

it.skipIf(!import.meta.env.LAB_CENTER_SCALE)('records the native visible center scale sweep', async () => {
  const device = await createDevice('webgpu')
  const gl = await createDevice('webgl', document.createElement('canvas'))
  const rows: CenterScaleResult[] = []
  const report = {
    question: 'How do the current recursive center reduction and force scale on this device?',
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
    webgpu: {
      info: device.info,
      limits: {
        maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
        maxBufferSize: device.limits.maxBufferSize,
        maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension,
      },
      timestampQuery: device.features.has('timestamp-query'),
    },
    webgl: gl.info,
    luma: '10.0.0-alpha.15',
    workload: 'Deterministic offset/asymmetric float32 positions; all present; 1 in 101 pinned; alpha=1, center strength=1',
    timing: 'Two warmups and seven samples; GPU timestamps separately for resident reduction, current force and linear candidate; WebGL includes readback.',
    limit: scaleLimit(device),
    aboveLimit: '',
    rows,
    status: 'running',
    error: '',
  }
  gl.destroy()
  try {
    if (!report.sourceSnapshot || !report.sourceRevision) throw new Error('Source snapshot and revision are required')
    if (document.visibilityState !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) {
      throw new Error('The timed sweep requires a visible native browser')
    }
    if (device.info.fallback !== false) throw new Error('The WebGPU adapter did not confirm a non-fallback device')
    try { await runScaleCount(device, report.limit + 1) } catch (error) { report.aboveLimit = String(error) }
    if (!report.aboveLimit.includes('force dispatch / buffer limit')) throw new Error('Above-limit guard did not reject the input')
    await writeArtifact('center-scale', report)
    const counts = import.meta.env.LAB_SCALE_COUNT
      ? [import.meta.env.LAB_SCALE_COUNT]
      : [8192, 65536, 100000, 1000000, 2000000, 4000000]
    for (const count of counts) {
      if (count > report.limit) {
        report.status = 'implementation limit'
        report.error = `Next requested count ${count} exceeds current shader/buffer limit ${report.limit}`
        break
      }
      const result = await runScaleCount(device, count)
      rows.push(result)
      // Persist each completed count, even if a later count is interrupted.
      await writeArtifact('center-scale', report)
      const high = result.webgpu.find(value => value.variant === 'high-low')!
      if (high.force.summary.completionMs > 2000 || ('elapsedMs' in result.webgl && result.webgl.elapsedMs > 2000)) {
        report.status = 'stopped after slow case'; break
      }
    }
    if (report.status === 'running') report.status = 'completed selected counts'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally {
    await writeArtifact('center-scale', report); device.destroy()
  }
  expect(report.error).toBe('')
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every(row => row.webgpu.find(value => value.variant === 'high-low')?.countExact)).toBe(true)
}, 900000)
