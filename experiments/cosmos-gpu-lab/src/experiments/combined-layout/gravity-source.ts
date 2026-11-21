import { replaceOnce } from '../many-body-grid/trace'
import trigSource from './gravity-trig.wgsl?raw'
import { roundedArithmetic } from './spring-precision'
export const polarGravitySource = `${roundedArithmetic}
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<uniform> params: vec4f;
@group(0) @binding(2) var<storage, read_write> forces: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(params.x)) { return; }
  let delta = -positions[id.x].xy;
  let distance = springRoot(springAdd(springMul(delta.x, delta.x), springMul(delta.y, delta.y)));
  var force = vec2f(0.);
  if (distance > 0.) {
    let angle = atan2(delta.y, delta.x);
    let magnitude = springMul(springMul(springMul(params.y, params.z), distance), 0.1);
    force = vec2f(springMul(magnitude, cos(angle)), springMul(magnitude, sin(angle)));
  }
  forces[id.x] = vec4f(force, 0., 0.);
}`

export const refinedGravitySource = trigSource + replaceOnce(replaceOnce(polarGravitySource,
  'let angle = atan2(delta.y, delta.x);', 'let angle = gravityAngle(delta.y, delta.x);'),
'    force = vec2f(springMul(magnitude, cos(angle)), springMul(magnitude, sin(angle)));',
`    let trig = gravitySinCos(vec2f(angle, 0.));
    let cosine = trig.cosine.x; let sine = trig.sine.x;
    force = vec2f(springMul(magnitude, cosine), springMul(magnitude, sine));`)
