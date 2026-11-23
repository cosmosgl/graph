struct Params { count: u32, points: u32, padding: vec2u }
@group(0) @binding(0) var<storage, read> input: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@group(0) @binding(2) var<uniform> params: Params;
var<workgroup> scratch: array<vec4f, 256>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_id) local: vec3u,
  @builtin(workgroup_id) group: vec3u) {
  var value = vec4f(0.);
  if (id.x < params.count) {
    if (params.points != 0u) {
      // Branch before adding XY: absent NaN sentinels cannot poison the sum.
      if (input[id.x].w <= 0.5) { value = vec4f(input[id.x].xy, 1., 0.); }
    } else { value = input[id.x]; }
  }
  scratch[local.x] = value;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) {
    if (local.x < stride) { scratch[local.x] = scratch[local.x] + scratch[local.x + stride]; }
    workgroupBarrier();
  }
  if (local.x == 0u) { output[group.x] = scratch[0]; }
}
