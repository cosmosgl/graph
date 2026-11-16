import original from '../curved-links/curves.wgsl?raw'
import { SOURCE_ALPHA_WGSL } from '../../gpu/source-alpha'

// Keep the existing raster/coverage path verbatim. Fail loudly if its geometry changes.
const start = '  let current = conic('
const end = '  let world = current + curveNormal'
const a = original.indexOf(start); const b = original.indexOf(end)
if (a < 0 || b <= a) throw new Error('Curve geometry extraction changed')
export const vertexSource = `${original}\n${SOURCE_ALPHA_WGSL}`
export const cachedSource = `${original.slice(0, a)}
  let sample = samples[instance * (u32(params.curve.x) + 1u) + index / 2u];
  let current = sample.xy; let curveNormal = sample.zw;
${original.slice(b)}
@group(0) @binding(4) var<storage,read> samples: array<vec4f>;
${SOURCE_ALPHA_WGSL}`

// One invocation per center/normal, shared by the two ribbon sides and all draws.
// No CPU geometry/readback in the render path; no cross-workgroup synchronization.
export const computeSource = `
${original.slice(0, original.indexOf('struct Vertex'))}
@group(0) @binding(4) var<storage,read_write> samples: array<vec4f>;
${original.slice(original.indexOf('fn conic('), original.indexOf('@vertex'))}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let count = u32(params.curve.x) + 1u;
  let instance = gid.x / count; let index = (gid.x % count) * 2u;
  if (instance >= arrayLength(&links)) { return; }
  let link = links[instance]; let a = positions[link.endpoints.x]; let b = positions[link.endpoints.y];
  let delta = b.xy - a.xy; let distance = length(delta);
  if (a.z > 0.5 || b.z > 0.5 || distance == 0.0) { samples[gid.x] = vec4f(0); return; }
  let normal = normalize(vec2f(-delta.y,delta.x));
  let control = (a.xy + b.xy) / 2.0 + normal * distance * params.curve.z;
  let t = nodes[index].x;
${original.slice(a, b)}
  samples[gid.x] = vec4f(current,curveNormal);
}`
