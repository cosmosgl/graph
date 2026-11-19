@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> forces: array<vec4f>;
// Pointer world X/Y, signed repulsion strength and logical point count.
@group(0) @binding(2) var<uniform> params: vec4f;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= u32(params.w)) { return; }
  let point = positions[index];
  if (point.w > 0.5) {
    forces[index] = vec4f(0.);
    return;
  }

  let delta = point.xy - params.xy;
  let distance = length(delta);
  // There is no direction at coincidence. The legacy shader calls atan(0, 0).
  if (distance == 0.) {
    forces[index] = vec4f(0.);
    return;
  }
  let clamped = max(distance, 10.);
  let strength = 100. * params.z / (clamped * clamped);
  forces[index] = vec4f(strength * (delta / distance), 0., 0.);
}
