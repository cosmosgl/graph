// Diagnostic candidate: the magnitude in the current center shader is
// distance * alpha * strength * 0.01, so its direction and distance cancel.
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<uniform> params: vec4f;
@group(0) @binding(2) var<storage, read_write> forces: array<vec4f>;
@group(0) @binding(3) var<storage, read> centermass: array<vec4f>;

fn finite(value: f32) -> bool {
  return (bitcast<u32>(value) & 0x7f800000u) != 0x7f800000u;
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(params.x)) { return; }
  let point = positions[id.x];
  let sum = centermass[0];
  if (sum.z == 0. || !finite(point.x) || !finite(point.y)) {
    forces[id.x] = vec4f(0.);
    return;
  }
  let delta = sum.xy / sum.z - point.xy;
  forces[id.x] = vec4f(delta * ((params.y * params.z) * 0.01), 0., 0.);
}
