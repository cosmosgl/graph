@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> aggregates: array<vec4f>;
@group(0) @binding(2) var<storage, read> membership: array<i32>;
@group(0) @binding(3) var<storage, read> targets: array<vec4f>;
@group(0) @binding(4) var<storage, read> strengths: array<f32>;
@group(0) @binding(5) var<storage, read_write> forces: array<vec4f>;
@group(0) @binding(6) var<uniform> params: vec4f;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(params.x)) { return; }
  forces[id.x] = vec4f(0.);
  let group = membership[id.x]; let point = positions[id.x];
  if (group < 0 || point.w > 0.5) { return; }
  var destination = targets[u32(group)].xy;
  if (targets[u32(group)].z < 0.5) {
    let sum = aggregates[u32(group)]; if (sum.z == 0.) { return; }
    destination = vec2f(springDiv(sum.x, sum.z), springDiv(sum.y, sum.z));
  }
  let delta = vec2f(springSub(destination.x, point.x), springSub(destination.y, point.y));
  let distance = springRoot(springAdd(springMul(delta.x, delta.x), springMul(delta.y, delta.y)));
  if (distance > 0.) {
    let magnitude = springMul(springMul(springMul(params.y, distance), params.z), strengths[id.x]);
    forces[id.x] = vec4f(springMul(magnitude, springDiv(delta.x, distance)), springMul(magnitude, springDiv(delta.y, distance)), 0., 0.);
  }
}
