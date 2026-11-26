struct Edits {
  colorFields: f32,
  stride: f32,
  fields: array<f32>,
}
@group(0) @binding(0) var<storage, read_write> points: array<Point>;
@group(0) @binding(1) var<storage, read> edits: Edits;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = invocation.x + invocation.y * groups.x * 64u;
  let stride = u32(edits.stride);
  let at = i * stride;
  if (at >= arrayLength(&edits.fields)) { return; }

  let colorFields = u32(edits.colorFields);
  var defaults = u32(points[i].effects.w);
  if (colorFields > 0u) {
    points[i].color = vec4f(edits.fields[at], edits.fields[at + 1u], edits.fields[at + 2u], edits.fields[at + 3u]);
    defaults = (defaults & 16u) | u32(edits.fields[at + 4u]);
  }
  if (stride > colorFields) {
    let size = at + colorFields;
    points[i].metrics.x = edits.fields[size];
    points[i].metrics.w = edits.fields[size + 1u];
    defaults = (defaults & 15u) | u32(edits.fields[size + 2u]);
  }
  points[i].effects.w = f32(defaults);
}
