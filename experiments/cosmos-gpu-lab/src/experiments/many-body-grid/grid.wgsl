struct Params {
  count: f32, finest: f32, levelCount: f32, slotsCount: f32,
  alpha: f32, repulsion: f32, nearLimit: f32, quality: f32,
  seed: f32, cellCount: f32, pad0: f32, pad1: f32
}
@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> samples: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> heads: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> links: array<u32>;
@group(0) @binding(4) var<storage, read_write> aggregates: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> slots: array<vec2<f32>>;
@group(0) @binding(6) var<storage, read_write> forces: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> levels: array<vec4<u32>>;
@group(0) @binding(8) var<uniform> params: Params;
@group(0) @binding(9) var<uniform> box: vec4<f32>;
const EMPTY = 0xffffffffu;
fn gridCell(p: vec2<f32>, n: u32) -> vec2<u32> {
  let scaled = (p - box.xy) * (box.w * f32(n));
  return vec2<u32>(clamp(floor(scaled), vec2(0.), vec2(f32(n - 1u))));
}
fn pointHash(i: u32) -> f32 {
  var h = i ^ bitcast<u32>(params.seed);
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  let fraction = (f32(h >> 8u) + 0.5) / 16777216.;
  let scaled = fraction * 0.998;
  return 0.001 + scaled;
}
@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < u32(params.cellCount)) { atomicStore(&heads[gid.x], EMPTY); }
}
@compute @workgroup_size(64)
fn linkPoints(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; let count = u32(params.count);
  if (i >= count || positions[i].w > 0.5) { return; }
  for (var level = 0u; level < u32(params.levelCount); level++) {
    let n = levels[level].x; let cell = gridCell(positions[i].xy, n);
    let key = levels[level].y + cell.y * n + cell.x;
    links[level * count + i] = atomicExchange(&heads[key], i);
  }
}
@compute @workgroup_size(64)
fn aggregate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cell = gid.x; if (cell >= u32(params.cellCount)) { return; }
  var level = 0u;
  for (var l = 1u; l < u32(params.levelCount); l++) { if (cell >= levels[l].y) { level = l; } }
  var point = atomicLoad(&heads[cell]); var occupancy = 0u;
  var indices: array<u32,128>;
  for (var visited = 0u; point != EMPTY && visited < u32(params.count); visited++) {
    if (occupancy < 128u) { indices[occupancy] = point; }
    occupancy++; point = links[level * u32(params.count) + point];
  }
  var sum = vec4(0.);
  if (occupancy <= 128u) {
    // Stable source-index accumulation, independent of atomic insertion order.
    for (var i = 1u; i < occupancy; i++) {
      let value = indices[i]; var j = i;
      while (j > 0u) { if (indices[j-1u] <= value) { break; } indices[j] = indices[j-1u]; j--; }
      indices[j] = value;
    }
    for (var i = 0u; i < occupancy; i++) { sum += vec4(positions[indices[i]].xy, 1., 0.); }
  } else {
    // Bounded diagnostic fallback: avoid quadratic sorting in one crowded cell.
    // This scans all sources for dense cells; it is not a production scaling strategy.
    let n = levels[level].x; let localCell = cell - levels[level].y;
    for (var i = 0u; i < u32(params.count); i++) {
      if (positions[i].w > 0.5) { continue; }
      let c = gridCell(positions[i].xy, n);
      if (c.y * n + c.x == localCell) { sum += vec4(positions[i].xy, 1., 0.); }
    }
  }
  aggregates[cell] = sum;
}
@compute @workgroup_size(64)
fn selectSlots(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cell = gid.x; let cells = u32(params.finest * params.finest);
  if (cell >= cells) { return; }
  let level = u32(params.levelCount) - 1u;
  let head = atomicLoad(&heads[levels[level].y + cell]);
  var previous = -1.;
  for (var slot = 0u; slot < u32(params.slotsCount); slot++) {
    var best = EMPTY; var bestHash = 1.; var point = head;
    for (var visited = 0u; point != EMPTY && visited < u32(params.count); visited++) {
      let value = pointHash(point);
      if (value > previous && (value < bestHash || (value == bestHash && point < best))) { best = point; bestHash = value; }
      point = links[level * u32(params.count) + point];
    }
    slots[slot * cells + cell] = vec2(select(f32(best), -1., best == EMPTY), bestHash);
    previous = bestHash;
  }
}
fn pairVelocity(delta: vec2<f32>, randomDir: vec2<f32>, mass: f32) -> vec2<f32> {
  var dist = delta; var l = dot(dist, dist);
  if (l <= 0.) { dist = randomDir; l = dot(dist, dist); if (l <= 0.) { return vec2(0.); } }
  if (l < 1.) { l = sqrt(l); }
  return (params.alpha * params.repulsion * mass / sqrt(l)) * normalize(dist);
}
@compute @workgroup_size(64)
fn forceMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let targetIndex = gid.x; if (targetIndex >= u32(params.count)) { return; }
  let point = positions[targetIndex];
  if (point.w > 0.5) { forces[targetIndex] = vec4(0.); return; }
  var far = vec2(0.);
  for (var level = 0u; level < u32(params.levelCount); level++) {
    let n = levels[level].x; let cell = vec2<i32>(gridCell(point.xy, n));
    let shell = select(1, 2, params.quality > 0.5 && level + 1u < u32(params.levelCount));
    let parentShell = select(1, 2, params.quality > 0.5);
    var base = vec2(0); var width = i32(n);
    if (level > 0u) { base = (cell / 2) * 2 - vec2(2 * parentShell); width = 2 * (2 * parentShell + 1); }
    var velocity = vec2(0.);
    for (var j = 0; j < width; j++) { for (var i = 0; i < width; i++) {
      let candidate = base + vec2(i, j); let diff = abs(candidate - cell);
      if (any(candidate < vec2(0)) || any(candidate >= vec2(i32(n))) || max(diff.x,diff.y) <= shell) { continue; }
      let a = aggregates[levels[level].y + u32(candidate.y) * n + u32(candidate.x)];
      if (a.z > 0.) { velocity += pairVelocity(point.xy - a.xy / a.z, vec2(0.), a.z); }
    } }
    far += velocity;
  }
  let n = u32(params.finest); let cells = n * n; let cell = vec2<i32>(gridCell(point.xy, n));
  var near = vec2(0.); let randomDir = samples[targetIndex];
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let candidate = cell + vec2(i, j);
    if (any(candidate < vec2(0)) || any(candidate >= vec2(i32(n)))) { continue; }
    let index = u32(candidate.y) * n + u32(candidate.x);
    let mass = aggregates[levels[u32(params.levelCount) - 1u].y + index].z - select(0., 1., i == 0 && j == 0);
    if (mass <= 0.) { continue; }
    var sum = vec2(0.); var sampled = 0.;
    for (var s = 0u; s < u32(params.slotsCount); s++) {
      let entry = slots[s * cells + index]; if (entry.x < 0.) { break; }
      let source = u32(entry.x); if (source == targetIndex) { continue; }
      sampled += 1.; sum += pairVelocity(point.xy - positions[source].xy, randomDir, 1.);
    }
    if (sampled > 0.) { near += (mass / sampled) * sum; }
  } }
  near += near * randomDir;
  let speed = length(near); if (speed > params.nearLimit) { near *= params.nearLimit / speed; }
  forces[targetIndex] = vec4(far + near, 0., 0.);
}
