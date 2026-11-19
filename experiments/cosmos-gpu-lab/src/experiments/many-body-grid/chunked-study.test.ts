import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { expect, it } from 'vitest'
import { bindingLayout, createDevice, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { createFixture } from '../many-body/data'
import { aggregationWork } from './aggregation'
import { frameFor } from './data'
import { denseScanWork, gridBufferPlan } from './chunked-study'
import { farResources } from './far-resources'

it('matches the existing CPU aggregation-work counter and counts the reusable scratch', () => {
  for (const [fixture, count] of [['uniform', 257], ['coincident', 129], ['clusters', 512]] as const) {
    const { points } = createFixture(fixture, count); const frame = frameFor(points, 0)
    const actual = denseScanWork(points, frame)
    for (const threshold of [32, 128]) {
      const expected = aggregationWork(points, frame, threshold)
      for (const [i, element] of expected.entries()) {
        const row = actual[i]; const result = row.byThreshold.find(value => value.threshold === threshold)!
        expect(row.grid).toBe(element.grid); expect(row.occupied).toBe(element.occupied)
        expect(row.maxOccupancy).toBe(element.maxOccupancy); expect(result.denseCells).toBe(element.dense)
        expect(result.sourceIterations).toBe(element.denseSourceTests)
      }
    }
  }
  const plan = gridBufferPlan(1000000)
  expect(plan.oldScratchBytes).toBe(800000000)
  expect(plan.chunkScratchBytes).toBe(13107200)
  expect(plan.buffers.find(buffer => buffer.name === 'far-cumulative-sums')!.bytes).toBe(56000000)
})

it.skipIf(!import.meta.env.LAB_REPULSION_MEMORY)('allocates and touches the planned million-point repulsion buffers', async () => {
  const count = 1000000; const input = createFixture('uniform', count); const frame = frameFor(input.points, 0, 8)
  const plan = gridBufferPlan(count); const denseWork = denseScanWork(input.points, frame)
  const errors: string[] = []
  const device = await createDevice('webgpu', document.createElement('canvas'), true, error => { errors.push(error.message) })
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  const report = {
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    webgpu: device.info,
    webgl: webgl.info,
    limits: {
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxBufferSize: device.limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension,
    },
    workload: 'One million deterministic uniform points, seed 29471; eight near-field slots; CPU-modeled cell occupancy.',
    luma: '10.0.0-alpha.15',
    plan,
    denseWork,
    errors,
    touched: [] as string[],
    alternatives: [] as Array<{ chunkSize: number; bytes: number; extraDispatches: number; touched: boolean }>,
    status: 'running',
    scope: 'Major estimated repulsion/base buffers only; one word per 4 KiB page touched. No full graph or force computation.',
  }
  webgl.destroy()
  const scope = resourceScope()
  try {
    if (!report.sourceRevision || !report.sourceSnapshot) throw new Error('Source snapshot and revision are required')
    if (device.info.fallback !== false) throw new Error('A non-fallback WebGPU adapter is required')
    await writeArtifact('repulsion-memory', report)
    const limit = Math.min(Number(device.limits.maxStorageBufferBindingSize), Number(device.limits.maxBufferSize))
    if (plan.buffers.some(buffer => buffer.bytes > limit)) throw new Error('A planned buffer exceeds a device limit')
    const buffers = plan.buffers.map(buffer => ({
      name: buffer.name,
      buffer: scope.own(device.createBuffer({ byteLength: buffer.bytes, usage: Buffer.STORAGE | Buffer.COPY_SRC })),
    }))
    const kernel = scope.own(await Kernel.createAsync(device, {
      source: `
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x * 1024u;
  if (index < arrayLength(&data)) { data[index] = 0x3f800000u; }
}`,
      shaderLayout: { bindings: bindingLayout([['data', 'storage']]) },
    }))
    const pass = device.beginComputePass()
    try {
      for (const entry of buffers) {
        const pages = Math.ceil(entry.buffer.byteLength / 4096)
        kernel.dispatch(pass, { x: Math.ceil(pages / 64), bindings: { data: entry.buffer } })
      }
    } finally { pass.end() }
    device.submit(); await waitForGpu(device, 15000)
    for (const entry of buffers) {
      const bytes = await entry.buffer.readAsync(0, 4)
      if (new Uint32Array(bytes.buffer, bytes.byteOffset, 1)[0] !== 0x3f800000) throw new Error(`Buffer touch failed: ${entry.name}`)
      report.touched.push(entry.name)
    }
    for (const chunkSize of [65536, 131072]) {
      const bytes = gridBufferPlan(count, chunkSize).chunkScratchBytes
      if (bytes > limit) continue
      const buffer = device.createBuffer({ byteLength: bytes, usage: Buffer.STORAGE | Buffer.COPY_SRC })
      try {
        const extra = device.beginComputePass()
        try { kernel.dispatch(extra, { x: Math.ceil(Math.ceil(bytes / 4096) / 64), bindings: { data: buffer } }) } finally { extra.end() }
        device.submit(); await waitForGpu(device, 15000)
        const readback = await buffer.readAsync(0, 4)
        const touched = new Uint32Array(readback.buffer, readback.byteOffset, 1)[0] === 0x3f800000
        report.alternatives.push({ chunkSize, bytes, extraDispatches: farResources(count, 'chunked', chunkSize).extraDispatches, touched })
        if (!touched) throw new Error(`Buffer touch failed for chunk ${chunkSize}`)
      } finally { buffer.destroy() }
    }
    if (errors.length) throw new Error(errors.join('; '))
    report.status = 'complete'
  } catch (error) { report.status = 'error'; errors.push(String(error)) } finally {
    await writeArtifact('repulsion-memory', report); scope.destroy(); device.destroy()
  }
  expect(report.status, errors.join('; ')).toBe('complete')
  expect(report.touched).toHaveLength(plan.buffers.length)
}, 180000)
