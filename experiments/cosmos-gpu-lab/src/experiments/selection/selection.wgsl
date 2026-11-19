struct Selection {
  origin: vec2f,
  viewport: vec2f,
  translation: vec2f,
  zoom: f32,
  ratio: f32,
  bounds: vec4f,
  sizeScale: f32,
  maxSize: f32,
  scaleOnZoom: u32,
  pointCount: u32,
  pathLength: u32,
  usePolygon: u32,
}

@group(0) @binding(0) var<storage, read> points: array<vec4f>;
@group(0) @binding(1) var<storage, read> path: array<vec2f>;
@group(0) @binding(2) var<uniform> selection: Selection;
@group(0) @binding(3) var<storage, read_write> selected: array<u32>;

fn inRect(center: vec2f, resolvedSize: f32) -> bool {
  let size = resolvedSize * selection.sizeScale;
  if (size <= 0.0) { return false; }
  let sizeZoom = select(clamp(selection.zoom * 0.01, 1.0, 5.0), selection.zoom, selection.scaleOnZoom != 0u);
  let sizePx = min(size * selection.ratio * sizeZoom, selection.maxSize * selection.ratio);
  let radius = 0.5 * max(sizePx, 1.0) / selection.ratio;
  let low = 2.0 * (selection.bounds.xy - radius) / selection.viewport - 1.0;
  let high = 2.0 * (selection.bounds.zw + radius) / selection.viewport - 1.0;
  return all(center >= low) && all(center <= high);
}

fn inPolygon(center: vec2f) -> bool {
  let screen = (center + 1.0) * selection.viewport / 2.0;
  var inside = false;
  for (var i = 0u; i < min(selection.pathLength, 2048u); i++) {
    let a = path[i];
    let b = path[(i + 1u) % selection.pathLength];
    if ((a.y > screen.y) != (b.y > screen.y)) {
      if (screen.x < (b.x - a.x) * (screen.y - a.y) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= selection.pointCount) { return; }
  let point = points[id.x];
  selected[id.x] = 0u;
  if (point.w > 0.5) { return; }
  let normalized = (point.xy - selection.origin) * (2.0 / selection.viewport);
  let center = normalized * selection.zoom + selection.translation;
  if (selection.usePolygon != 0u) {
    selected[id.x] = select(0u, 1u, inPolygon(center));
  } else {
    selected[id.x] = select(0u, 1u, inRect(center, point.z));
  }
}
