@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> normalized: array<vec2f>;
@group(0) @binding(2) var<uniform> params: vec4u;
@group(0) @binding(3) var<storage, read> box: vec4f;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= params.x) { return; }
  let n = f32(params.y); let point = positions[i];
  var cell = vec2f(0.);
  if (point.w <= 0.5) { cell = clamp(floor((point.xy - box.xy) * (box.w * n)), vec2f(0.), vec2f(n - 1.)); }
  // Encode the exact cell centre, avoiding a second floating-point decision at
  // cell boundaries when the existing index converts from [-1, 1].
  normalized[i] = ((cell + 0.5) / n) * 2. - 1.;
}
