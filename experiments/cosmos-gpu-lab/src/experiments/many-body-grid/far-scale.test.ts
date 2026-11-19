import { Buffer, type BindingDeclaration } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { expect, it } from 'vitest'
import { bindingLayout, createDevice, readFloats, upload } from '../../gpu/luma'
import { BufferLedger, resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { differingBits } from '../combined-layout/resident'
import { createFixture, nearLimit, PARAMETERS } from '../many-body/data'
import { compareArray } from '../many-body/reference'
import { measureBatch, median, timestamps, type Measurement } from '../many-body/timing'
import { centroidReference, storedCentroidShader } from './centroids'
import { buildReference, frameFor, layout } from './data'
import { refinedFarShader, workgroupFarShader, workgroupLocalFarShader } from './far-shader'
import { refinedNearShader } from './near-shader'
import { gridReference } from './reference'
import shader from './grid.wgsl?raw'

it('selects target forces without changing the independent scalar reference', () => {
  const input = createFixture('edge-cases'); const frame = frameFor(input.points, 0)
  const structure = buildReference(input.points, frame); const centroids = centroidReference(structure)
  const full = gridReference(input, input.points, PARAMETERS, frame, structure, undefined, 'rounded', centroids)
  const targets = [0, 2, 4, 7]
  const selected = gridReference(input, input.points, PARAMETERS, frame, structure, undefined, 'rounded', centroids, targets)
  for (const target of targets) {
    expect([...selected.forces.slice(target * 4, target * 4 + 4)]).toEqual([...full.forces.slice(target * 4, target * 4 + 4)])
  }
})

it.skipIf(!import.meta.env.LAB_FAR_SCALE)('runs the isolated far and near force for a million pre-indexed points', async () => {
  const count = import.meta.env.LAB_SCALE_COUNT || 1000000
  if (!Number.isInteger(count) || count < 4 || count > 1000000) throw new Error('Invalid isolated force count')
  const input = createFixture('uniform', count)
  input.points[2] = 1; input.points.set([NaN, NaN, 0, 1], 4)
  const frame = frameFor(input.points, 0, 8, false)
  const structure = buildReference(input.points, frame); const l = layout(count)
  const centroids = centroidReference(structure)
  const targetCount = Math.min(512, count)
  const targets = Array.from({ length: targetCount }, (_, i) => Math.floor(i * count / targetCount))
  targets.push(1)
  const expected = gridReference(input, input.points, PARAMETERS, frame, structure, undefined, 'rounded', centroids, targets)
  const device = await createDevice('webgpu', document.createElement('canvas'))
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  const ledger = new BufferLedger(); const scope = resourceScope(ledger)
  const report: {
    sourceRevision: string; sourceSnapshot: string; browser: string; visibility: string; device: unknown; webgl: unknown;
    limits: unknown; luma: string; count: number; levels: number[]; slots: number; precise: boolean; targets: number;
    scope: string; policy: unknown; deviceBufferBytes: number; status: string; error: string;
    rows: Array<{ name: string; cpu: ReturnType<typeof compareArray>; nonfinite: number; bitsVsDirect: number; bitsVsWorkgroup: number | null;
      repeatBits: number | null; pilot: Measurement; samples: Measurement[]; status: string; gpuMs: number | null; range: number[] | null; }>;
  } = {
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    device: device.info,
    webgl: webgl.info,
    limits: {
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension,
    },
    luma: '10.0.0-alpha.15',
    count,
    levels: l.sizes,
    slots: frame.slots,
    precise: frame.precise,
    targets: targets.length,
    scope: 'One force dispatch only. CPU-built hierarchy, centroids and sample slots; no GPU grid, integration, links or drawing.',
    policy: { warmups: 3, samples: 7, operations: 1, order: 'rotate', workgroupPilotLimitMs: 1500 },
    deviceBufferBytes: 0,
    status: 'running',
    error: '',
    rows: [],
  }
  webgl.destroy()
  try {
    if (!report.sourceRevision || !report.sourceSnapshot) throw new Error('Source snapshot and revision are required')
    if (report.visibility !== 'visible' || navigator.userAgent.includes('HeadlessChrome') || device.info.fallback !== false) {
      throw new Error('The study requires a visible browser and non-fallback WebGPU adapter')
    }
    if (Math.ceil(count / 64) > Number(device.limits.maxComputeWorkgroupsPerDimension)) throw new Error('Dispatch exceeds device limit')
    await writeArtifact('repulsion-isolated-million', report)
    const own = scope.own
    const positions = own(upload(device, input.points)); const samples = own(upload(device, input.samples))
    const aggregates = own(upload(device, structure.aggregates)); const slots = own(upload(device, structure.slots))
    const centers = own(upload(device, centroids))
    const levels = own(upload(device, new Uint32Array(l.sizes.flatMap((n, i) => [n, l.offsets[i], 0, 0]))))
    const params = own(upload(device, new Float32Array([count, l.finest, l.sizes.length, frame.slots,
      PARAMETERS.alpha, PARAMETERS.repulsion, nearLimit(count, PARAMETERS), 0, frame.seed, l.cells, 0, 0]), Buffer.UNIFORM))
    const box = own(upload(device, frame.bounds, Buffer.UNIFORM))
    const entries: Array<[string, 'storage' | 'read-only-storage' | 'uniform']> = [
      ['positions', 'read-only-storage'], ['samples', 'read-only-storage'], ['aggregates', 'storage'], ['slots', 'storage'],
      ['forces', 'storage'], ['levels', 'read-only-storage'], ['params', 'uniform'], ['box', 'uniform'], ['centroids', 'storage'],
    ]
    const locations = [0, 1, 4, 5, 6, 7, 8, 9, 11]
    const bindings: BindingDeclaration[] = bindingLayout(entries).map((entry, i) => ({ ...entry, location: locations[i] }))
    const common = storedCentroidShader(shader, true)
    const modes = [
      { name: 'direct', source: refinedNearShader(refinedFarShader(common)) },
      { name: 'workgroup', source: refinedNearShader(workgroupFarShader(common)) },
      { name: 'workgroup-local', source: refinedNearShader(workgroupLocalFarShader(common)) },
    ]
    const outputs = modes.map(() => own(device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })))
    const kernels: Kernel[] = []
    for (const mode of modes) {
      kernels.push(own(await Kernel.createAsync(device, {
        id: `scale-${mode.name}`,
        source: mode.source,
        entryPoint: 'forceMain',
        shaderLayout: { bindings },
      })))
    }
    report.deviceBufferBytes = ledger.liveBytes
    const run = (i: number): Promise<Measurement> => measureBatch(device, 1, (query, first, last) => {
      const pass = device.beginComputePass(timestamps(query, first, last))
      try {
        kernels[i].dispatch(pass, {
          x: Math.ceil(count / 64),
          bindings: {
            positions, samples, aggregates, slots, forces: outputs[i], levels, params, box, centroids: centers,
          },
        })
      } finally { pass.end() }
    })
    const initial: Float32Array[] = []
    const select = (data: Float32Array): Float32Array => {
      const result = new Float32Array(targets.length * 4)
      targets.forEach((target, i) => result.set(data.subarray(target * 4, target * 4 + 4), i * 4))
      return result
    }
    for (const [i, mode] of modes.entries()) {
      const pilot = await run(i); const force = await readFloats(outputs[i]); initial.push(force)
      let nonfinite = 0
      for (let j = 0; j < force.length; j += 4) {
        if (!Number.isFinite(force[j]) || !Number.isFinite(force[j + 1])) nonfinite++
      }
      const tooSlow = mode.name.startsWith('workgroup') && pilot.batchCompletionMs > 1500
      report.rows.push({
        name: mode.name,
        cpu: compareArray(select(force), select(expected.forces)),
        nonfinite,
        bitsVsDirect: differingBits(force, initial[0]),
        bitsVsWorkgroup: i > 0 ? differingBits(force, initial[1]) : null,
        repeatBits: null,
        pilot,
        samples: [],
        status: tooSlow ? 'pilot-only' : 'running',
        gpuMs: null,
        range: null,
      })
      await writeArtifact('repulsion-isolated-million', report)
    }
    for (let round = 0; round < 10; round++) {
      for (let order = 0; order < modes.length; order++) {
        const i = (round + order) % modes.length
        if (report.rows[i].status !== 'running') continue
        if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during timing')
        const sample = await run(i)
        if (round >= 3) report.rows[i].samples.push(sample)
      }
    }
    for (const [i, row] of report.rows.entries()) {
      if (row.status !== 'running') continue
      row.repeatBits = differingBits(initial[i], await readFloats(outputs[i]))
      const timed = row.samples.length === 7 && row.samples.every(value => value.timerStatus === 'valid' &&
        value.batchGpuMs !== null && Number.isFinite(value.batchGpuMs) && value.batchGpuMs > 0)
      if (timed && row.repeatBits === 0 && row.nonfinite === 0) {
        const gpu = row.samples.map(value => value.batchGpuMs!)
        row.gpuMs = median(gpu); row.range = [Math.min(...gpu), Math.max(...gpu)]; row.status = 'complete'
      } else row.status = 'invalid'
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally {
    await writeArtifact('repulsion-isolated-million', report); scope.destroy(); device.destroy()
  }
  expect(ledger.liveBytes).toBe(0)
  expect(report.status, report.error).toBe('complete')
}, 900000)
