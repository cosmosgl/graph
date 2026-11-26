struct View {
  translation: vec2f,
  zoom: f32,
  sizeScale: f32,
  bounds: vec4f,
  sizeZoom: f32,
  pixelRatio: f32,
  pathLength: u32,
}
@group(0) @binding(0) var<storage, read> points: array<vec4f>;
@group(0) @binding(1) var<storage, read> sizes: array<f32>;
@group(0) @binding(2) var<storage, read> path: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> mask: array<u32>;
@group(0) @binding(4) var<uniform> view: View;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&mask)) { return; }
  let p = points[id.x];
  if (p.w != 0.0) { return; }
  let screen = view.translation + p.xy * vec2f(view.zoom, -view.zoom);
  if (view.pathLength == 0u) {
    let size = sizes[id.x] * view.sizeScale;
    if (size <= 0.0) { return; }
    let radius = 0.5 * max(size * view.sizeZoom, 1.0 / view.pixelRatio);
    mask[id.x] = select(0u, 1u, all(screen >= view.bounds.xy - radius) && all(screen <= view.bounds.zw + radius));
    return;
  }
  var inside = false;
  for (var i = 0u; i < view.pathLength; i++) {
    let a = path[i];
    let b = path[(i + 1u) % view.pathLength];
    if ((a.y < screen.y) != (b.y < screen.y)) {
      if (screen.x < a.x + (screen.y - a.y) / (b.y - a.y) * (b.x - a.x)) { inside = !inside; }
    }
  }
  mask[id.x] = select(0u, 1u, inside);
}
