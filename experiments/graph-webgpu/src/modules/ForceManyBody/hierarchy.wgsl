// Complete quadtree in Morton order. Leaves accumulate quantized local offsets so
// floating-point atomics are unnecessary. Internal nodes contain world centroids.
struct Leaf { x: atomic<u32>, y: atomic<u32>, count: atomic<u32> }
struct Params {
  count: u32, width: u32, depth: u32, quantization: u32,
  alpha: f32, strength: f32, theta: f32, nearRadius: f32
}
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> bounds: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> leaves: array<Leaf>;
@group(0) @binding(3) var<storage, read_write> tree: array<vec4f>;
@group(0) @binding(4) var<uniform> settings: Params;
@group(0) @binding(5) var<uniform> level: vec4u;
@group(0) @binding(6) var<storage, read> samples: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> forces: array<vec4f>;

fn extent() -> f32 { return max(1., max(bounds[0].z - bounds[0].x, bounds[0].w - bounds[0].y)); }
fn gridPoint(p: vec2f) -> vec2f {
  // The upper edge belongs to the final cell.
  return clamp((p - bounds[0].xy) / extent() * f32(settings.width), vec2f(0.), vec2f(f32(settings.width)));
}
fn morton(xy: vec2u) -> u32 {
  var code = 0u;
  for (var bit = 0u; bit < settings.depth; bit++) {
    code |= ((xy.x >> bit) & 1u) << (bit * 2u);
    code |= ((xy.y >> bit) & 1u) << (bit * 2u + 1u);
  }
  return code;
}
fn levelStart(depth: u32) -> u32 { return ((1u << (2u * depth)) - 1u) / 3u; }
fn cellOf(q: vec2f) -> vec2u { return min(vec2u(q), vec2u(settings.width - 1u)); }

@compute @workgroup_size(64) fn clearLeaves(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&leaves)) { return; }
  atomicStore(&leaves[id.x].count, 0u);
  atomicStore(&leaves[id.x].x, 0u);
  atomicStore(&leaves[id.x].y, 0u);
}
@compute @workgroup_size(64) fn placePoints(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.count || positions[id.x].w > 0.5) { return; }
  let q = gridPoint(positions[id.x].xy);
  let cell = cellOf(q);
  let slot = cell.y * settings.width + cell.x;
  let fraction = vec2u(round((q - vec2f(cell)) * f32(settings.quantization)));
  atomicAdd(&leaves[slot].x, fraction.x);
  atomicAdd(&leaves[slot].y, fraction.y);
  atomicAdd(&leaves[slot].count, 1u);
}
@compute @workgroup_size(64) fn leafCentroids(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&leaves)) { return; }
  let cell = vec2u(id.x % settings.width, id.x / settings.width);
  let i = levelStart(settings.depth) + morton(cell);
  let n = atomicLoad(&leaves[id.x].count);
  if (n == 0u) { tree[i] = vec4f(0.); return; }
  let sum = vec2f(f32(atomicLoad(&leaves[id.x].x)), f32(atomicLoad(&leaves[id.x].y)));
  let q = vec2f(cell) + sum / (f32(settings.quantization) * f32(n));
  tree[i] = vec4f(bounds[0].xy + q * (extent() / f32(settings.width)), f32(n), 0.);
}
@compute @workgroup_size(64) fn mergeLevel(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= level.y) { return; }
  let i = level.x + id.x;
  var sum = vec3f(0.);
  for (var child = 1u; child <= 4u; child++) {
    let item = tree[4u * i + child];
    sum += vec3f(item.xy * item.z, item.z);
  }
  tree[i] = vec4f(sum.xy / max(1., sum.z), sum.z, 0.);
}
@compute @workgroup_size(64) fn repulse(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.count) { return; }
  let p = positions[id.x];
  if (p.w > 0.5 || p.z > 0.5) { forces[id.x] = vec4f(0.); return; }
  let own = morton(cellOf(gridPoint(p.xy)));
  let span = extent();
  let near2 = settings.nearRadius * settings.nearRadius;
  var far = vec2f(0.); var near = vec2f(0.);
  // Depth is at most nine. A depth-first traversal holds at most 3*depth+1 nodes.
  var stack: array<vec2u, 28>;
  var size = 1u;
  stack[0] = vec2u(0u);
  while (size > 0u) {
    size--;
    let item = stack[size];
    let node = tree[item.x];
    if (node.z == 0.) { continue; }
    let containsSelf = item.x == levelStart(item.y) + (own >> (2u * (settings.depth - item.y)));
    let delta = p.xy - node.xy;
    let length2 = dot(delta, delta);
    let side = span / f32(1u << item.y);
    if (item.y < settings.depth && (containsSelf || side * side > settings.theta * settings.theta * length2)) {
      for (var c = 1u; c <= 4u; c++) { stack[size] = vec2u(item.x * 4u + c, item.y + 1u); size++; }
      continue;
    }
    let mass = node.z - select(0., 1., containsSelf);
    if (mass <= 0.) { continue; }
    var separation = delta * select(1., node.z / mass, containsSelf);
    var sq = dot(separation, separation);
    let isNear = sq < near2;
    if (sq == 0.) { separation = samples[id.x]; sq = dot(separation, separation); }
    if (sq == 0.) { continue; }
    let direction = normalize(separation);
    let kick = direction * (settings.strength * settings.alpha * mass / sqrt(select(sq, sqrt(sq), sq < 1.)));
    if (isNear) { near += kick; } else { far += kick; }
  }
  near += near * samples[id.x];
  let speed = length(near);
  if (speed > settings.nearRadius) { near *= settings.nearRadius / speed; }
  forces[id.x] = vec4f(near + far, 0., 0.);
}
