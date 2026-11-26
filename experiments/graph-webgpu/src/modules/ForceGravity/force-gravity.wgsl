@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@group(0) @binding(2) var<uniform> params: vec4f;

@compute @workgroup_size(64) fn gravity(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let index = id.x + id.y * groups.x * 64u;
  if (index >= arrayLength(&positions)) { return; }
  let delta = params.xy - positions[index].xy;
  let distance = length(delta);
  var velocity = vec2f(0.);
  if (distance > 0.) {
    let angle = atan2(delta.y, delta.x);
    velocity = (params.z * params.w * distance * 0.1) * vec2f(cos(angle), sin(angle));
  }
  output[index] = vec4f(velocity, 0., 0.);
}
