import { Kernel } from '@luma.gl/graph'
import { bindingLayout, createDevice, readFloats, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { createGraph } from '../combined-layout/data'
import { createCombinedWebGL } from '../combined-layout/webgl'
import { forceSettings } from '../combined-layout/production-settings'

export async function productionGravity (points: Float32Array): Promise<{ forces: Float32Array; device: string }> {
  const { graph, input } = createGraph({ count: points.length / 4, fixture: 'chain', decay: 100 })
  graph.points = input.points = points
  const backend = await createCombinedWebGL(document.createElement('canvas'), graph, input, {
    forceSettings: { ...forceSettings('reference', points.length / 4), origin: [0, 0] }, repulsionPolicy: 'production',
  })
  try { backend.stepStage('gravity', 1); return { forces: (await backend.read()).forces, device: backend.info } } finally { backend.destroy() }
}

// Native diagnostic alternatives: no integer-controlled rounding or trig refinement.
const gravityPrefix = `
@group(0) @binding(0) var<storage, read> points: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&points)) { return; }
  let delta = -points[id.x].xy;
`
const cartesian = `${gravityPrefix}
  output[id.x] = vec4f(delta * (1.0 * 0.25 * 0.1), 0., 0.);
}`
const polar = `${gravityPrefix}
  let distance = sqrt(dot(delta, delta));
  var force = vec2f(0.);
  if (distance > 0.) {
    let angle = atan2(delta.y, delta.x);
    let magnitude = 1.0 * 0.25 * distance * 0.1;
    force = magnitude * vec2f(cos(angle), sin(angle));
  }
  output[id.x] = vec4f(force, 0., 0.);
}`
const sumPrefix = `
@group(0) @binding(0) var<storage, read> values: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
`
const serial = `${sumPrefix}
@compute @workgroup_size(1) fn main() {
  var total = 0.;
  for (var i = 0u; i < arrayLength(&values); i++) { total += values[i]; }
  output[0] = vec4f(total, 0., 0., 0.);
}`
const blocked = `${sumPrefix}
@compute @workgroup_size(1) fn main() {
  var total = 0.;
  for (var start = 0u; start < arrayLength(&values); start += 64u) {
    var part = 0.;
    for (var i = start; i < min(start + 64u, arrayLength(&values)); i++) { part += values[i]; }
    total += part;
  }
  output[0] = vec4f(total, 0., 0., 0.);
}`
const tree = `${sumPrefix}
var<workgroup> partials: array<f32, 256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane: u32) {
  var total = 0.;
  for (var i = lane; i < arrayLength(&values); i += 256u) { total += values[i]; }
  partials[lane] = total;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) {
    if (lane < stride) { partials[lane] += partials[lane + stride]; }
    workgroupBarrier();
  }
  if (lane == 0u) { output[0] = vec4f(partials[0], 0., 0., 0.); }
}`

export async function nativeDiagnostics (points: Float32Array, values: Float32Array): Promise<{
  gravity: Array<{ name: string; forces: Float32Array }>;
  sums: Array<{ name: string; value: number }>;
  device: string;
}> {
  const device = await createDevice('webgpu', undefined, false)
  const scope = resourceScope()
  try {
    const positions = scope.own(upload(device, points)); const input = scope.own(upload(device, values))
    const forces = scope.own(upload(device, new Float32Array(points.length)))
    const sumOutput = scope.own(upload(device, new Float32Array(4)))
    const evaluate = async (source: string, field: 'points' | 'values'): Promise<Float32Array> => {
      const kernel = scope.own(await Kernel.createAsync(device, {
        source, shaderLayout: { bindings: bindingLayout([[field, 'read-only-storage'], ['output', 'storage']]) },
      }))
      const pass = device.beginComputePass()
      try {
        kernel.dispatch(pass, {
          x: field === 'points' ? Math.ceil(points.length / 4 / 64) : 1,
          bindings: { [field]: field === 'points' ? positions : input, output: field === 'points' ? forces : sumOutput },
        })
      } finally { pass.end() }
      device.submit()
      return await readFloats(field === 'points' ? forces : sumOutput)
    }
    const gravity = []
    for (const [name, source] of [['WGSL native polar', polar], ['WGSL Cartesian', cartesian]]) gravity.push({ name, forces: await evaluate(source, 'points') })
    const sums = []
    for (const [name, source] of [['WGSL serial', serial], ['WGSL blocked 64', blocked], ['WGSL tree 256', tree]]) {
      sums.push({ name, value: (await evaluate(source, 'values'))[0] })
    }
    return { gravity, sums, device: `${String(device.info.vendor)} / ${String(device.info.renderer)}` }
  } finally { try { scope.destroy() } finally { device.destroy() } }
}
