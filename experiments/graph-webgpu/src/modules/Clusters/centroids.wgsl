@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> ids: array<u32>;
@group(0) @binding(2) var<storage, read> offsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> aggregates: array<vec4f>;
var<workgroup> sums: array<vec4f, 64>;

@compute @workgroup_size(64) fn main(@builtin(workgroup_id) g: vec3u, @builtin(local_invocation_id) local: vec3u,
  @builtin(num_workgroups) groups: vec3u) {
  // Groups are laid out in a 2D dispatch if their count exceeds the per-axis limit.
  let group = g.x + g.y * groups.x;
  if (group >= arrayLength(&aggregates)) { return; }
  var sum = vec4f(0.);
  for (var i = offsets[group] + local.x; i < offsets[group + 1u]; i += 64u) {
    let p = positions[ids[i]];
    if (p.w <= 0.5) { sum += vec4f(p.xy, 1., 0.); }
  }
  sums[local.x] = sum;
  workgroupBarrier();
  for (var stride = 32u; stride != 0u; stride /= 2u) {
    if (local.x < stride) { sums[local.x] += sums[local.x + stride]; }
    workgroupBarrier();
  }
  if (local.x == 0u) { aggregates[group] = sums[0]; }
}
