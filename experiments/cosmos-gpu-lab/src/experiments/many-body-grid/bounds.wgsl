@group(0) @binding(0) var<storage, read> values: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> partials: array<vec4f>;
@group(0) @binding(2) var<uniform> params: vec4u;
var<workgroup> sharedBounds: array<vec4f, 256>;

// min x, min y, max x, max y. Absent/padding lanes are the identity.
fn identity() -> vec4f { return vec4f(3.402823466e38, 3.402823466e38, -3.402823466e38, -3.402823466e38); }
fn combine(a: vec4f, b: vec4f) -> vec4f { return vec4f(min(a.xy, b.xy), max(a.zw, b.zw)); }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
        @builtin(workgroup_id) group: vec3u) {
  var value = identity();
  if (gid.x < params.x) {
    let v = values[gid.x];
    if (params.y == 0u) {
      if (v.w <= 0.5) { value = vec4f(v.xy, v.xy); }
    } else { value = v; }
  }
  sharedBounds[lid.x] = value;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) {
    if (lid.x < stride) { sharedBounds[lid.x] = combine(sharedBounds[lid.x], sharedBounds[lid.x + stride]); }
    workgroupBarrier();
  }
  if (lid.x == 0u) { partials[group.x] = sharedBounds[0]; }
}
