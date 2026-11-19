import { Buffer, type BindingDeclaration } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { expect, it } from 'vitest'
import { bindingLayout, createDevice, readFloats, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import { differingBits } from '../combined-layout/resident'
import { createFixture, nearLimit, PARAMETERS, type Fixture } from '../many-body/data'
import { compareArray } from '../many-body/reference'
import { measureBatch, median, timestamps, type Measurement } from '../many-body/timing'
import { createCpuGridReference, validateGrid, type GridValidation } from '../spatial-grid/reference'
import { createSpatialGridResources } from '../spatial-grid/resources'
import { centroidReference } from './centroids'
import { buildReference, frameFor, layout } from './data'
import { fastForceSource } from './fast-force'
import { gridReference } from './reference'
import { orderTargetsByCell, spatialOrderShader } from './spatial-order'

const normalizeSource = `
struct Params { count: f32, finest: f32, levels: f32, slots: f32, alpha: f32, repulsion: f32,
  limit: f32, quality: f32, seed: f32, cells: f32, pad0: f32, pad1: f32 }
@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> normalized: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<uniform> box: vec4<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= u32(params.count)) { return; }
  let p = positions[id.x];
  if (p.w > 0.5) { normalized[id.x] = vec2<f32>(-1.); return; }
  normalized[id.x] = ((p.xy - box.xy) * box.w) * 2. - vec2<f32>(1.);
}`

type Row = {
  name: string; kind: string; pilot: Measurement; samples: Measurement[]; gpuMs: number | null; range: number[] | null;
  initialBits: number | null; repeatBits: number | null; cpu: ReturnType<typeof compareArray> | null; status: string;
}

it.skipIf(!import.meta.env.LAB_REPULSION_GPU_ORDER)('builds a GPU target order and uses it directly in a million-point force', async () => {
  const count = import.meta.env.LAB_SCALE_COUNT || 1000000
  if (!Number.isInteger(count) || count < 4 || count > 1000000) throw new Error('Invalid isolated force count')
  const errors: string[] = []
  const device = await createDevice('webgpu', document.createElement('canvas'), true, error => { errors.push(error.message) })
  let deviceLoss: { reason: string; message: string } | null = null
  device.lost.then(info => { if (info.reason !== 'destroyed') deviceLoss = { reason: info.reason, message: info.message } })
    .catch(error => { errors.push(String(error)) })
  let phase = 'setup'
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  const report: {
    sourceRevision: string; sourceSnapshot: string; browser: string; visibility: string; device: unknown; webgl: unknown;
    luma: string; scope: string; policy: unknown; errors: string[]; status: string;
    cases: Array<{ fixture: string; count: number; gridSize: number; indexBytes: number; normalizedBytes: number;
      initialGrid: GridValidation | null; finalGrid: GridValidation | null; rows: Row[]; }>;
  } = {
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    device: device.info,
    webgl: webgl.info,
    luma: '10.0.0-alpha.15',
    scope: 'GPU position normalization + finest-cell count/scan/scatter + native force; hierarchy and sample slots prebuilt on CPU.',
    policy: { warmups: 3, samples: 7, operations: 1, order: 'rotate', gpuOrderInterval: 'normalize, clear, count, scan, scatter, force' },
    errors,
    status: 'running',
    cases: [],
  }
  webgl.destroy()
  try {
    if (!report.sourceRevision || !report.sourceSnapshot) throw new Error('Source snapshot and revision are required')
    if (report.visibility !== 'visible' || navigator.userAgent.includes('HeadlessChrome') || device.info.fallback !== false) {
      throw new Error('The study requires a visible browser and non-fallback WebGPU adapter')
    }
    await writeArtifact('repulsion-gpu-order', report)
    for (const fixture of ['uniform', 'clusters'] as Fixture[]) {
      const input = createFixture(fixture, count); input.points[2] = 1; input.points.set([NaN, NaN, 0, 1], 4)
      const frame = frameFor(input.points, 0, 8, false); const l = layout(count)
      const structure = buildReference(input.points, frame); const centers = centroidReference(structure)
      const targetCount = Math.min(512, count)
      const targets = Array.from({ length: targetCount }, (_, i) => Math.floor(i * count / targetCount)); targets.push(1)
      const expected = gridReference(input, input.points, PARAMETERS, frame, structure, undefined, 'rounded', centers, targets)
      const select = (data: Float32Array): Float32Array => {
        const selected = new Float32Array(targets.length * 4)
        targets.forEach((target, i) => selected.set(data.subarray(target * 4, target * 4 + 4), i * 4))
        return selected
      }
      const record: typeof report.cases[number] = {
        fixture,
        count,
        gridSize: l.finest,
        indexBytes: 0,
        normalizedBytes: count * 8,
        initialGrid: null,
        finalGrid: null,
        rows: [],
      }
      report.cases.push(record); await writeArtifact('repulsion-gpu-order', report)
      const scope = resourceScope(); const own = scope.own
      try {
        const positions = own(upload(device, input.points)); const samples = own(upload(device, input.samples))
        const aggregates = own(upload(device, structure.aggregates)); const slots = own(upload(device, structure.slots))
        const centroids = own(upload(device, centers)); const cpuOrder = own(upload(device, orderTargetsByCell(input.points, frame)))
        const levels = own(upload(device, new Uint32Array(l.sizes.flatMap((n, i) => [n, l.offsets[i], 0, 0]))))
        const params = own(upload(device, new Float32Array([count, l.finest, l.sizes.length, frame.slots,
          PARAMETERS.alpha, PARAMETERS.repulsion, nearLimit(count, PARAMETERS), 0, frame.seed, l.cells, 0, 0]), Buffer.UNIFORM))
        const box = own(upload(device, frame.bounds, Buffer.UNIFORM))
        const normalized = own(device.createBuffer({ byteLength: count * 8, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
        const grid = own(createSpatialGridResources(device, [normalized], count, l.finest)); record.indexBytes = grid.gridBytes
        const normalize = own(await Kernel.createAsync(device, {
          source: normalizeSource,
          shaderLayout: { bindings: bindingLayout([['positions', 'read-only-storage'], ['normalized', 'storage'], ['params', 'uniform'], ['box', 'uniform']]) },
        }))
        const entries: Array<[string, 'storage' | 'read-only-storage' | 'uniform']> = [
          ['positions', 'read-only-storage'], ['samples', 'read-only-storage'], ['aggregates', 'storage'], ['slots', 'storage'],
          ['forces', 'storage'], ['levels', 'read-only-storage'], ['params', 'uniform'], ['box', 'uniform'], ['centroids', 'storage'],
        ]
        const locations = [0, 1, 4, 5, 6, 7, 8, 9, 11]
        const bindings: BindingDeclaration[] = bindingLayout(entries).map((entry, i) => ({ ...entry, location: locations[i] }))
        const orderedBindings: BindingDeclaration[] = [...bindings, { name: 'targetOrder', location: 12, group: 0, type: 'read-only-storage' }]
        const unordered = own(await Kernel.createAsync(device, {
          source: fastForceSource('native-both'), entryPoint: 'forceMain', shaderLayout: { bindings },
        }))
        const ordered = own(await Kernel.createAsync(device, {
          source: spatialOrderShader(fastForceSource('native-both')), entryPoint: 'forceMain', shaderLayout: { bindings: orderedBindings },
        }))
        const names = ['native-unordered', 'cpu-grouped', 'gpu-grouped', 'gpu-group-and-force', 'gpu-group-only'] as const
        const outputs = names.map(() => own(device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })))
        const run = (i: number): Promise<Measurement> => measureBatch(device, 1, (query, first, last) => {
          const build = i >= 3
          if (build) {
            const pass = device.beginComputePass(timestamps(query, first, false))
            try { normalize.dispatch(pass, { x: Math.ceil(count / 256), bindings: { positions, normalized, params, box } }) } finally { pass.end() }
            grid.encodeBuild(device.commandEncoder, 0, i === 4 ? timestamps(query, false, last) : {})
            // Submit the index build before its consumer. Both remain on the
            // GPU and share one timestamp interval across submissions.
            if (i === 3) device.submit()
          }
          if (i !== 4) {
            const pass = device.beginComputePass(timestamps(query, build ? false : first, last))
            try {
              const common = { positions, samples, aggregates, slots, forces: outputs[i], levels, params, box, centroids }
              const forceBindings = i === 0 ? common : { ...common, targetOrder: i === 1 ? cpuOrder : grid.pointIndices }
              const kernel = i === 0 ? unordered : ordered
              kernel.dispatch(pass, { x: Math.ceil(count / 64), bindings: forceBindings })
            } finally { pass.end() }
          }
        })
        // Build a GPU order before force-only controls; correctness readbacks are outside timed samples.
        await run(4)
        const normal = await readFloats(normalized)
        const expectedGrid = createCpuGridReference(normal, l.finest)
        const firstGrid = await grid.readback()
        record.initialGrid = validateGrid(normal, l.finest, expectedGrid, firstGrid.counts, firstGrid.offsets, firstGrid.pointIndices)
        if (errors.length) throw new Error(errors.join('; '))
        const initial: Float32Array[] = []
        for (const [i, name] of names.entries()) {
          phase = `pilot ${name}`
          const pilot = await run(i)
          if (errors.length) throw new Error(errors.join('; '))
          const force = i === 4 ? new Float32Array() : await readFloats(outputs[i]); initial.push(force)
          record.rows.push({
            name,
            kind: i === 4 ? 'order' : 'force',
            pilot,
            samples: [],
            gpuMs: null,
            range: null,
            initialBits: i === 4 ? null : differingBits(force, initial[0]),
            repeatBits: null,
            cpu: i === 4 ? null : compareArray(select(force), select(expected.forces)),
            status: pilot.batchCompletionMs > 1500 ? 'pilot-only' : 'running',
          })
          await writeArtifact('repulsion-gpu-order', report)
        }
        for (let round = 0; round < 10; round++) {
          for (let order = 0; order < names.length; order++) {
            const i = (round + order) % names.length; if (record.rows[i].status !== 'running') continue
            phase = `round ${round} ${names[i]}`
            if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during timing')
            const measurement = await run(i)
            if (document.visibilityState !== 'visible' || errors.length) throw new Error(errors.join('; ') || 'The tab was hidden during timing')
            if (round >= 3) record.rows[i].samples.push(measurement)
          }
        }
        const lastGrid = await grid.readback()
        record.finalGrid = validateGrid(normal, l.finest, expectedGrid, lastGrid.counts, lastGrid.offsets, lastGrid.pointIndices)
        for (const [i, row] of record.rows.entries()) {
          if (row.status !== 'running') continue
          if (row.kind === 'force') row.repeatBits = differingBits(initial[i], await readFloats(outputs[i]))
          const timed = row.samples.length === 7 && row.samples.every(value => value.timerStatus === 'valid' &&
            value.batchGpuMs !== null && Number.isFinite(value.batchGpuMs) && value.batchGpuMs > 0)
          const forceMatches = row.kind !== 'force' || (row.initialBits === 0 && row.repeatBits === 0)
          if (timed && forceMatches && record.initialGrid.valid && record.finalGrid.valid) {
            const gpu = row.samples.map(value => value.batchGpuMs!)
            row.gpuMs = median(gpu); row.range = [Math.min(...gpu), Math.max(...gpu)]; row.status = 'complete'
          } else row.status = 'invalid'
        }
        await writeArtifact('repulsion-gpu-order', report)
      } finally { scope.destroy() }
    }
    report.status = 'complete'
  } catch (error) {
    report.status = 'error'; errors.push(`${phase}: ${String(error)}`)
    if (device.isLost) { const info = await device.lost; deviceLoss = { reason: info.reason, message: info.message } }
    if (deviceLoss) errors.push(`Device loss: ${deviceLoss.reason}: ${deviceLoss.message}`)
  } finally {
    await writeArtifact('repulsion-gpu-order', report); device.destroy()
  }
  expect(report.status, errors.join('; ')).toBe('complete')
  expect(report.cases.every(value => value.initialGrid?.valid && value.finalGrid?.valid)).toBe(true)
  expect(report.cases.every(value => value.rows.every(row => row.status === 'complete'))).toBe(true)
}, 900000)
