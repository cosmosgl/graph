@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> attractors: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> forces: array<vec4f>;
@group(0) @binding(3) var<uniform> params: vec4f;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(params.x)) { return; }
  forces[id.x] = vec4f(0.);
  let point = positions[id.x]; let attractor = attractors[id.x];
  if (attractor.w <= 0.5 || point.w > 0.5) { return; }
  let delta = vec2f(springSub(attractor.x, point.x), springSub(attractor.y, point.y));
  let distance = springRoot(springAdd(springMul(delta.x, delta.x), springMul(delta.y, delta.y)));
  if (distance > 0.) {
    let magnitude = springMul(springMul(springMul(params.y, distance), params.z), attractor.z);
    forces[id.x] = vec4f(springMul(magnitude, springDiv(delta.x, distance)), springMul(magnitude, springDiv(delta.y, distance)), 0., 0.);
  }
}
