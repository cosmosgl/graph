import { Buffer, type BindingDeclaration } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { expect, it } from 'vitest'
import { bindingLayout, createDevice, readFloats, upload } from '../../gpu/luma'
import { BufferLedger, resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { differingBits } from '../combined-layout/resident'
import { createFixture, nearLimit, PARAMETERS, type Fixture } from '../many-body/data'
import { compareArray } from '../many-body/reference'
import { measureBatch, median, timestamps, type Measurement } from '../many-body/timing'
import { centroidReference } from './centroids'
import { buildReference, frameFor, layout } from './data'
import { FORCE_VARIANTS, fastForceSource, isolatedForceSource } from './fast-force'
import { gridReference } from './reference'
import { orderTargetsByCell, spatialOrderShader } from './spatial-order'

type ErrorStats = { nrmsePercent: number; rms: number; max: number; sampleCount: number; relativePercent: number[] }
function errorStats (actual: Float32Array, reference: Float32Array, points: Float32Array): ErrorStats {
  let error2 = 0; let norm2 = 0; let max = 0; let present = 0
  const samples: number[] = []; const stride = Math.max(1, Math.floor(points.length / 4 / 16384))
  for (let i = 0; i < points.length / 4; i++) {
    const j = i * 4; if (points[j + 3] > 0.5) continue
    const error = Math.hypot(actual[j] - reference[j], actual[j + 1] - reference[j + 1])
    const magnitude = Math.hypot(reference[j], reference[j + 1])
    error2 += error * error; norm2 += magnitude * magnitude; max = Math.max(max, error); present++
    if (i % stride === 0) samples.push(100 * error / Math.max(magnitude, 1e-12))
  }
  samples.sort((a, b) => a - b)
  return {
    nrmsePercent: norm2 ? 100 * Math.sqrt(error2 / norm2) : 0,
    rms: Math.sqrt(error2 / Math.max(1, present)),
    max,
    sampleCount: samples.length,
    relativePercent: [0.5, 0.95, 0.99, 1].map(q => samples[Math.floor((samples.length - 1) * q)] ?? 0),
  }
}
type Row = {
  name: string; fixture: string; count: number; kind: string; nonfinite: number; bitsVsCorrected: number;
  bitsVsUnordered: number | null;
  cpu: ReturnType<typeof compareArray> | null; strictVsCorrected: ReturnType<typeof compareArray> | null; error: ErrorStats | null;
  repeatBits: number | null; pilot: Measurement; samples: Measurement[]; status: string;
  gpuMs: number | null; range: number[] | null;
}

it.skipIf(!import.meta.env.LAB_REPULSION_FAST)('measures the million-point force arithmetic alternatives and split diagnostics', async () => {
  const count = import.meta.env.LAB_SCALE_COUNT || 1000000
  if (!Number.isInteger(count) || count < 4 || count > 1000000) throw new Error('Invalid isolated force count')
  const deviceErrors: string[] = []
  const device = await createDevice('webgpu', document.createElement('canvas'), true, error => { deviceErrors.push(error.message) })
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  const report: {
    sourceRevision: string; sourceSnapshot: string; browser: string; visibility: string; device: unknown; webgl: unknown;
    limits: unknown; luma: string; scope: string; policy: unknown; status: string; error: string;
    deviceErrors: string[];
    fixtures: Array<{ fixture: string; count: number; levels: number[]; buffers: number; orderCpuMs: number; orderPermutation: boolean;
      splitRecombined: ReturnType<typeof compareArray> | null; rows: Row[]; }>;
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
    scope: 'Frozen full or split force dispatch, CPU-prepared hierarchy; no GPU grid, integration, links or rendering.',
    policy: { warmups: 3, samples: 7, operations: 1, order: 'rotate', workgroupPilotLimitMs: 1500 },
    status: 'running',
    error: '',
    deviceErrors,
    fixtures: [],
  }
  webgl.destroy()
  try {
    if (!report.sourceRevision || !report.sourceSnapshot) throw new Error('Source snapshot and revision are required')
    if (report.visibility !== 'visible' || navigator.userAgent.includes('HeadlessChrome') || device.info.fallback !== false) {
      throw new Error('The study requires a visible browser and non-fallback WebGPU adapter')
    }
    if (Math.ceil(count / 64) > Number(device.limits.maxComputeWorkgroupsPerDimension)) throw new Error('Dispatch exceeds device limit')
    await writeArtifact('repulsion-fast-force', report)
    for (const fixture of ['uniform', 'clusters'] as Fixture[]) {
      const input = createFixture(fixture, count)
      input.points[2] = 1; input.points.set([NaN, NaN, 0, 1], 4)
      const frame = frameFor(input.points, 0, 8, false)
      const structure = buildReference(input.points, frame); const l = layout(count); const centers = centroidReference(structure)
      const targetCount = Math.min(512, count)
      const targets = Array.from({ length: targetCount }, (_, i) => Math.floor(i * count / targetCount)); targets.push(1)
      const expected = gridReference(input, input.points, PARAMETERS, frame, structure, undefined, 'rounded', centers, targets)
      const select = (data: Float32Array): Float32Array => {
        const selected = new Float32Array(targets.length * 4)
        targets.forEach((target, i) => selected.set(data.subarray(target * 4, target * 4 + 4), i * 4))
        return selected
      }
      const orderStart = performance.now(); const order = orderTargetsByCell(input.points, frame); const orderCpuMs = performance.now() - orderStart
      const seen = new Uint8Array(count); let orderPermutation = order.length === count
      for (const index of order) { if (index >= count || seen[index]) orderPermutation = false; else seen[index] = 1 }
      if (!orderPermutation) throw new Error('Target ordering is not a permutation')
      const record: typeof report.fixtures[number] = {
        fixture, count, levels: l.sizes, buffers: 0, orderCpuMs, orderPermutation, splitRecombined: null, rows: [],
      }
      report.fixtures.push(record); await writeArtifact('repulsion-fast-force', report)
      const ledger = new BufferLedger(); const scope = resourceScope(ledger); const own = scope.own
      try {
        const positions = own(upload(device, input.points)); const samples = own(upload(device, input.samples))
        const aggregates = own(upload(device, structure.aggregates)); const slots = own(upload(device, structure.slots))
        const centroids = own(upload(device, centers))
        const targetOrder = own(upload(device, order))
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
        bindings.push({ name: 'targetOrder', location: 12, group: 0, type: 'read-only-storage' })
        const allBindings = entries.map(([name]) => name)
        const modes: Array<{ name: string; kind: 'full' | 'ordered' | 'split'; source: string; used: string[]; unordered?: number }> = [
          ...FORCE_VARIANTS.map(name => ({ name, kind: 'full' as const, source: fastForceSource(name), used: allBindings })),
          {
            name: 'corrected-ordered',
            kind: 'ordered' as const,
            source: spatialOrderShader(fastForceSource('corrected')),
            used: [...allBindings, 'targetOrder'],
            unordered: FORCE_VARIANTS.indexOf('corrected'),
          },
          {
            name: 'native-both-ordered',
            kind: 'ordered' as const,
            source: spatialOrderShader(fastForceSource('native-both')),
            used: [...allBindings, 'targetOrder'],
            unordered: FORCE_VARIANTS.indexOf('native-both'),
          },
          {
            name: 'factorized-both-ordered',
            kind: 'ordered' as const,
            source: spatialOrderShader(fastForceSource('factorized-both')),
            used: [...allBindings, 'targetOrder'],
            unordered: FORCE_VARIANTS.indexOf('factorized-both'),
          },
          {
            name: 'corrected-far-only',
            kind: 'split' as const,
            source: isolatedForceSource(fastForceSource('corrected'), 'far'),
            used: ['positions', 'aggregates', 'forces', 'levels', 'params', 'box', 'centroids'],
          },
          {
            name: 'corrected-near-only',
            kind: 'split' as const,
            source: isolatedForceSource(fastForceSource('corrected'), 'near'),
            used: ['positions', 'samples', 'aggregates', 'slots', 'forces', 'levels', 'params', 'box'],
          },
        ]
        const outputs = modes.map(() => own(device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })))
        const kernels: Kernel[] = []
        for (const mode of modes) {
          kernels.push(own(await Kernel.createAsync(device, {
            id: `force-speed-${mode.name}`,
            source: mode.source,
            entryPoint: 'forceMain',
            shaderLayout: { bindings: bindings.filter(binding => mode.used.includes(binding.name)) },
          })))
        }
        record.buffers = ledger.liveBytes
        const run = (i: number): Promise<Measurement> => measureBatch(device, 1, (query, first, last) => {
          const pass = device.beginComputePass(timestamps(query, first, last))
          try {
            kernels[i].dispatch(pass, {
              x: Math.ceil(count / 64),
              bindings: Object.fromEntries(Object.entries({
                positions, samples, aggregates, slots, forces: outputs[i], levels, params, box, centroids, targetOrder,
              }).filter(([name]) => modes[i].used.includes(name))),
            })
          } finally { pass.end() }
        })
        const initial: Float32Array[] = []
        for (const [i, mode] of modes.entries()) {
          const pilot = await run(i); const force = await readFloats(outputs[i]); initial.push(force)
          if (deviceErrors.length) throw new Error(deviceErrors.join('; '))
          let nonfinite = 0
          for (let j = 0; j < force.length; j += 4) if (!Number.isFinite(force[j]) || !Number.isFinite(force[j + 1])) nonfinite++
          const tooSlow = pilot.batchCompletionMs > 1500
          record.rows.push({
            name: mode.name,
            fixture,
            count,
            kind: mode.kind,
            nonfinite,
            bitsVsCorrected: differingBits(force, initial[0]),
            bitsVsUnordered: mode.unordered === undefined ? null : differingBits(force, initial[mode.unordered]),
            cpu: mode.kind !== 'split' ? compareArray(select(force), select(expected.forces)) : null,
            strictVsCorrected: mode.kind !== 'split' ? compareArray(force, initial[0]) : null,
            error: mode.kind !== 'split' ? errorStats(force, initial[0], input.points) : null,
            repeatBits: null,
            pilot,
            samples: [],
            status: tooSlow ? 'pilot-only' : 'running',
            gpuMs: null,
            range: null,
          })
          await writeArtifact('repulsion-fast-force', report)
        }
        const sum = new Float32Array(count * 4)
        const farOnly = initial[modes.findIndex(mode => mode.name === 'corrected-far-only')]
        const nearOnly = initial[modes.findIndex(mode => mode.name === 'corrected-near-only')]
        for (let i = 0; i < sum.length; i++) sum[i] = Math.fround(farOnly[i] + nearOnly[i])
        record.splitRecombined = compareArray(sum, initial[0])
        for (let round = 0; round < 10; round++) {
          for (let order = 0; order < modes.length; order++) {
            const i = (round + order) % modes.length; if (record.rows[i].status !== 'running') continue
            if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during timing')
            const measurement = await run(i)
            if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during timing')
            if (deviceErrors.length) throw new Error(deviceErrors.join('; '))
            if (round >= 3) record.rows[i].samples.push(measurement)
          }
        }
        for (const [i, row] of record.rows.entries()) {
          if (row.status !== 'running') continue
          row.repeatBits = differingBits(initial[i], await readFloats(outputs[i]))
          const timed = row.samples.length === 7 && row.samples.every(value => value.timerStatus === 'valid' &&
            value.batchGpuMs !== null && Number.isFinite(value.batchGpuMs) && value.batchGpuMs > 0)
          const splitMatches = row.kind !== 'split' || record.splitRecombined?.valid === true
          const orderMatches = row.kind !== 'ordered' || row.bitsVsUnordered === 0
          if (timed && row.repeatBits === 0 && row.nonfinite === 0 && splitMatches && orderMatches) {
            const gpu = row.samples.map(value => value.batchGpuMs!)
            row.gpuMs = median(gpu); row.range = [Math.min(...gpu), Math.max(...gpu)]; row.status = 'complete'
          } else row.status = 'invalid'
        }
        await writeArtifact('repulsion-fast-force', report)
      } finally { scope.destroy() }
      if (ledger.liveBytes !== 0) throw new Error('An isolated force buffer was retained')
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally {
    await writeArtifact('repulsion-fast-force', report); device.destroy()
  }
  expect(report.status, report.error).toBe('complete')
}, 900000)
