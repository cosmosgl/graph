import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, createDevice, readFloats, upload } from '../../gpu/luma'
import { buildTopology } from '../weighted-links/data'
import { compareArray, createReferenceIndex, TOLERANCE } from '../weighted-links/reference'
import { replaceOnce } from '../many-body-grid/trace'
import { createGraph, SPRINGS } from './data'
import { createRoundedKernel, distanceSpringSource, roundedIntegrationSource, type ProductCorrection } from './spring-precision'
import type { CombinedSession } from './session'
export const TRACE_FIELDS = ['before x', 'before y', 'delta x', 'delta y', 'length', 'ratio', 'scaled', 'weighted',
  'biased', 'product x', 'product y', 'unused', 'velocity x', 'velocity y', 'unused', 'unused'] as const
export type IsolationReport = {
  capture: string; tick: number; point: number; axis: number; alpha: number; input: number; actual: number; expected: number; budget: number;
  rows: Array<{ correction: ProductCorrection; forces: ReturnType<typeof compareArray>; positions: ReturnType<typeof compareArray>;
    matchesReferenceBits: boolean; }>;
  baselineMatchesCapture: boolean; traceMatchesBaseline: boolean;
  edges: number[]; expectedTrace: Float32Array; actualTrace: Float32Array;
}
function traceSource (): string {
  let s = distanceSpringSource()
  s = replaceOnce(s, '    let delta =', '    let before = velocity;\n    let delta =')
  s = replaceOnce(s, '    length = distanceDivide', '    let norm = length;\n    length = distanceDivide')
  s = replaceOnce(s,
    '    length *= params.spring * params.alpha;', '    let ratio = length;\n    length *= params.spring * params.alpha;\n    let scaled = length;')
  s = replaceOnce(s, '    length *= edge.strength;', '    length *= edge.strength;\n    let weighted = length;')
  s = replaceOnce(s, '    velocity += delta * length;', `    velocity += delta * length;
    {
      let slot = e * 4u;
      trace[slot] = vec4(before, delta);
      trace[slot + 1u] = vec4(norm, ratio, scaled, weighted);
      trace[slot + 2u] = vec4(length, delta * length, 0.);
      trace[slot + 3u] = vec4(velocity, 0., 0.);
    }`)
  return `${s}\n@group(0) @binding(6) var<storage, read_write> trace: array<vec4<f32>>;`
}
const sameBits = (a: Float32Array, b: Float32Array): boolean => {
  const aa = new Uint32Array(a.buffer, a.byteOffset, a.length); const bb = new Uint32Array(b.buffer, b.byteOffset, b.length)
  return aa.length === bb.length && aa.every((v, i) => v === bb[i])
}
// Replays in an isolated luma device. Instrumented output is checked against an uninstrumented baseline,
// since exporting intermediates can change compiler fusion. Only ablations use uninstrumented kernels.
export async function isolateSpringFailure (session: CombinedSession, cancelled: () => boolean = (): boolean => false): Promise<IsolationReport> {
  if (session.settings.springPrecision !== 'distance') throw new Error('Isolation requires a distance-only capture')
  const key = ['webgpu-outgoing', 'webgpu-incoming'].find(key => session.firstFailures[key])
  if (!key) throw new Error('Capture a failing WebGPU spring stage first')
  const capture = session.firstFailures[key]; const { graph } = createGraph(session.settings)
  let component = -1; let worst = 1
  for (let i = 0; i < capture.expected.positions.length; i++) {
    const ratio = Math.abs(capture.actual.positions[i] - capture.expected.positions[i]) /
      (TOLERANCE.absolute + TOLERANCE.relative * Math.abs(capture.expected.positions[i]))
    if (ratio > worst) { worst = ratio; component = i }
  }
  if (component < 0) throw new Error('The captured failure has no out-of-budget position component')
  const point = Math.floor(component / 4); const side = key.endsWith('incoming') ? 0 : 1
  const index = createReferenceIndex(graph); const edgeIds = index.byPoint[side][point]
  const f = Math.fround; const expectedTrace = new Float32Array(edgeIds.length * 16)
  let vx = 0; let vy = 0
  edgeIds.forEach((edgeId, slot) => {
    const other = graph.links[edgeId * 2 + 1 - side]
    const x = f(capture.input[other * 4] - f(capture.input[point * 4] + vx))
    const y = f(capture.input[other * 4 + 1] - f(capture.input[point * 4 + 1] + vy))
    const length = Math.max(f(Math.sqrt(f(f(x * x) + f(y * y)))), f(f(SPRINGS.distance) * f(0.99)))
    const ratio = f(f(length - f(SPRINGS.distance)) / length)
    const scaled = f(ratio * f(f(SPRINGS.spring) * f(capture.alpha)))
    const weighted = f(scaled * f(Math.sqrt(graph.weights[edgeId])))
    const biased = f(weighted * f(index.degrees[other] / (index.degrees[point] + index.degrees[other])))
    const px = f(x * biased); const py = f(y * biased)
    expectedTrace.set([vx, vy, x, y, length, ratio, scaled, weighted, biased, px, py, 0, f(vx + px), f(vy + py), 0, 0], slot * 16)
    vx = f(vx + px); vy = f(vy + py)
  })
  if (vx !== capture.expected.forces[point * 4] || vy !== capture.expected.forces[point * 4 + 1]) {
    throw new Error('Diagnostic CPU trace does not match the reference; this trace supports the fixed combined spring settings only')
  }
  const topology = buildTopology(graph).directions[side]
  const errors: string[] = []
  const device = await createDevice('webgpu', undefined, false, error => { errors.push(error.message); return true })
  const owned: Array<{ destroy(): void }> = []; const own = <T extends { destroy(): void }>(r: T): T => { owned.push(r); return r }
  try {
    const positions = own(upload(device, capture.input)); const offsets = own(upload(device, topology.offsets))
    const packed = new ArrayBuffer(topology.neighbors.length * 16); const ints = new Uint32Array(packed); const floats = new Float32Array(packed)
    for (let i = 0; i < topology.neighbors.length; i++) {
      ints[i * 4] = topology.neighbors[i]
      floats.set(topology.properties.subarray(i * 4, i * 4 + 3), i * 4 + 1)
    }
    const edges = own(upload(device, new Uint8Array(packed))); const sizes = own(upload(device, graph.sizes))
    const params = own(upload(device, new Float32Array([SPRINGS.spring, SPRINGS.distance, ...SPRINGS.variation, capture.alpha,
      SPRINGS.friction, SPRINGS.maxStep, 0, 0, 0, graph.sizes.length, 0]), Buffer.UNIFORM))
    const integrationParams = own(upload(device, new Float32Array([graph.sizes.length, 0, 0, 0, SPRINGS.friction, SPRINGS.maxStep, 0, 0]), Buffer.UNIFORM))
    const forces = own(upload(device, new Float32Array(capture.input.length))); const output = own(upload(device, capture.input))
    const trace = own(upload(device, new Float32Array(Math.max(4, topology.neighbors.length * 16)).fill(NaN)))
    const layout = bindingLayout([['positions', 'read-only-storage'], ['offsets', 'read-only-storage'], ['edges', 'read-only-storage'],
      ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage']])
    const integration = own(await createRoundedKernel(device, roundedIntegrationSource(), bindingLayout([
      ['positions', 'read-only-storage'], ['forces', 'read-only-storage'], ['params', 'uniform'], ['output', 'storage'],
    ])))
    const run = async (source: string, tracing = false): Promise<{ forces: Float32Array; positions: Float32Array }> => {
      if (cancelled()) throw new Error('Isolation stopped')
      const kernel = await Kernel.createAsync(device, {
        source,
        shaderLayout: {
          bindings: tracing
            ? [...layout, { name: 'trace', type: 'storage', location: 6, group: 0 }]
            : layout,
        },
      })
      try {
        forces.write(new Float32Array(capture.input.length).fill(NaN))
        output.write(new Float32Array(capture.input.length).fill(NaN))
        const pass = device.beginComputePass()
        try {
          kernel.dispatch(pass, {
            x: Math.ceil(graph.sizes.length / 64),
            bindings: { positions, offsets, edges, sizes, params, forces, ...(tracing ? { trace } : {}) },
          })
          integration.dispatch(pass, { x: Math.ceil(graph.sizes.length / 64), bindings: { positions, forces, params: integrationParams, output } })
        } finally { pass.end() }
        device.submit()
        const result = { forces: await readFloats(forces), positions: await readFloats(output) }
        if (errors.length) throw new Error(errors.join('; '))
        if (!result.forces.every(Number.isFinite) || !result.positions.every(Number.isFinite)) throw new Error('Replay did not write finite outputs')
        return result
      } finally { kernel.destroy() }
    }
    const baseline = await run(distanceSpringSource()); const instrumented = await run(traceSource(), true)
    const actualTrace = (await readFloats(trace)).slice(topology.offsets[point] * 16, topology.offsets[point + 1] * 16)
    if (!actualTrace.every(Number.isFinite)) throw new Error('Spring trace did not write all expected intermediates')
    const report: IsolationReport = {
      capture: key,
      tick: capture.tick,
      point,
      axis: component % 4,
      alpha: capture.alpha,
      input: capture.input[component],
      actual: capture.actual.positions[component],
      expected: capture.expected.positions[component],
      budget: TOLERANCE.absolute + TOLERANCE.relative * Math.abs(capture.expected.positions[component]),
      rows: [],
      baselineMatchesCapture: sameBits(baseline.forces, capture.actual.forces) && sameBits(baseline.positions, capture.actual.positions),
      traceMatchesBaseline: sameBits(instrumented.forces, baseline.forces) && sameBits(instrumented.positions, baseline.positions),
      edges: edgeIds,
      expectedTrace,
      actualTrace,
    }
    for (const correction of ['none', 'scale', 'accumulation', 'products'] as const) {
      const result = correction === 'none' ? baseline : await run(distanceSpringSource(correction))
      report.rows.push({
        correction,
        forces: compareArray(result.forces, capture.expected.forces),
        positions: compareArray(result.positions, capture.expected.positions),
        matchesReferenceBits: sameBits(result.forces, capture.expected.forces) && sameBits(result.positions, capture.expected.positions),
      })
    }
    return report
  } finally { try { owned.reverse().forEach(r => r.destroy()) } finally { device.destroy() } }
}
