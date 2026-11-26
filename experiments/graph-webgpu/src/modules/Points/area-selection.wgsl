struct View {
  origin: vec2f,
  screenSize: vec2f,
  transform: vec4f,
  bounds: vec4f,
  sizeScale: f32,
  pixelRatio: f32,
  sizeZoom: f32,
  pathLength: u32,
  centerOnly: u32,
}
@group(0) @binding(0) var<storage, read> points: array<vec4f>;
@group(0) @binding(1) var<storage, read> footprints: array<f32>;
@group(0) @binding(2) var<storage, read> path: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> mask: array<u32>;
@group(0) @binding(4) var<uniform> view: View;

// Separating axes of a segment and an axis-aligned square. A zero extent
// includes centers on the boundary, even at vertices or repeated points.
fn segmentTouchesSquare(a: vec2f, b: vec2f, center: vec2f, extent: f32) -> bool {
  let start = a - center;
  let end = b - center;
  if (any(min(start, end) > vec2f(extent)) || any(max(start, end) < vec2f(-extent))) { return false; }
  let edge = abs(b - a);
  return abs(start.x * end.y - start.y * end.x) <= extent * (edge.x + edge.y);
}

fn overlapsPolygon(center: vec2f, extent: f32, square: bool) -> bool {
  var inside = false;
  var a = path[view.pathLength - 1u];
  for (var i = 0u; i < view.pathLength; i++) {
    let b = path[i];
    let edge = b - a;
    if (square) {
      if (segmentTouchesSquare(a, b, center, extent)) { return true; }
    } else {
      let lengthSquared = dot(edge, edge);
      var t = 0.0;
      if (lengthSquared > 0.0) { t = clamp(dot(center - a, edge) / lengthSquared, 0.0, 1.0); }
      let delta = center - (a + t * edge);
      if (dot(delta, delta) <= extent * extent) { return true; }
    }
    if ((a.y > center.y) != (b.y > center.y)) {
      if (center.x < edge.x * (center.y - a.y) / edge.y + a.x) { inside = !inside; }
    }
    a = b;
  }
  return inside;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&mask)) { return; }
  let p = points[id.x];
  let footprint = footprints[id.x];
  let size = abs(footprint) * view.sizeScale;
  if (p.w != 0.0 || size <= 0.0) { return; }
  let normalized = (p.xy - view.origin) * (2.0 / view.screenSize);
  let ndc = normalized * view.transform.xy + view.transform.zw;
  let center = (ndc + 1.0) * view.screenSize * 0.5;
  let centerOnly = view.centerOnly != 0u;
  let radius = select(0.5 * max(size * view.pixelRatio * view.sizeZoom, 1.0) / view.pixelRatio, 0.0, centerOnly);
  let square = footprint < 0.0 || centerOnly;
  // An untextured square spans 80% of the sprite's diameter in the draw shader.
  let extent = select(radius, radius * 0.8, square);
  if (any(center + extent < view.bounds.xy) || any(center - extent > view.bounds.zw)) { return; }
  if (view.pathLength == 0u) {
    let delta = center - clamp(center, view.bounds.xy, view.bounds.zw);
    let touches = select(dot(delta, delta) <= radius * radius, all(abs(delta) <= vec2f(extent)), square);
    mask[id.x] = select(0u, 1u, touches);
  } else {
    mask[id.x] = select(0u, 1u, overlapsPolygon(center, extent, square));
  }
}
