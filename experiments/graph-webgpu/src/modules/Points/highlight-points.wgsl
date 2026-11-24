struct HighlightColors { normal: vec4f, grey: vec4f }
struct ChangedWord { index: u32, changed: u32, grey: u32 }
@group(0) @binding(0) var<storage, read_write> points: array<Point>;
@group(0) @binding(1) var<storage, read> colors: array<HighlightColors>;
@group(0) @binding(2) var<storage, read> changes: array<ChangedWord>;
@group(0) @binding(3) var<uniform> opacity: vec2f;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let lane = invocation.x + invocation.y * groups.x * 64u;
  if (lane / 32u >= arrayLength(&changes)) { return; }
  let word = changes[lane / 32u];
  let bit = 1u << (lane % 32u);
  if ((word.changed & bit) == 0u) { return; }
  let grey = (word.grey & bit) != 0u;
  let id = word.index * 32u + lane % 32u;
  let paint = colors[min(id, arrayLength(&colors) - 1u)];
  points[id].color = select(paint.normal, paint.grey, grey);
  points[id].effects.x = select(opacity.x, opacity.y, grey);
  points[id].effects.y = select(0.0, 1.0, grey);
}
