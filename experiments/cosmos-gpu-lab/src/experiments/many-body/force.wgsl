struct Params { count: f32, alpha: f32, repulsion: f32, nearLimit: f32, friction: f32, stepGuard: f32, pad0: f32, pad1: f32 }
@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> samples: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read_write> forces: array<vec4<f32>>;

struct Sums { near: vec2<f32>, far: vec2<f32> }
fn addPair(position: vec2<f32>, other: vec4<f32>, randomDir: vec2<f32>, previous: Sums) -> Sums {
  var sums = previous;
  if (other.w > 0.5) { return sums; }
  var delta = position - other.xy;
  let distance2 = dot(delta, delta);
  var l = distance2;
  if (l <= 0.) {
    delta = randomDir; l = dot(delta, delta);
    if (l <= 0.) { return sums; }
  }
  if (l < 1.) { l = sqrt(l); }
  let magnitude = params.alpha * params.repulsion / sqrt(l);
  let velocity = magnitude * normalize(delta);
  if (distance2 < params.nearLimit * params.nearLimit) { sums.near += velocity; }
  else { sums.far += velocity; }
  return sums;
}
fn finishForce(sums: Sums, randomDir: vec2<f32>) -> vec4<f32> {
  var near = sums.near + sums.near * randomDir;
  let speed = length(near);
  if (speed > params.nearLimit) { near *= params.nearLimit / speed; }
  return vec4(sums.far + near, 0., 0.);
}
@compute @workgroup_size(64)
fn direct(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.count)) { return; }
  let p = positions[i];
  if (p.w > 0.5) { forces[i] = vec4(0.); return; }
  var sums = Sums(vec2(0.), vec2(0.));
  for (var j = 0u; j < u32(params.count); j++) {
    if (i != j) { sums = addPair(p.xy, positions[j], samples[i], sums); }
  }
  forces[i] = finishForce(sums, samples[i]);
}
var<workgroup> tile: array<vec4<f32>, 64>;
@compute @workgroup_size(64)
fn tiled(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let i = gid.x;
  let count = u32(params.count);
  var p = vec4(0., 0., 0., 1.);
  var randomDir = vec2(0.);
  if (i < count) { p = positions[i]; randomDir = samples[i]; }
  var sums = Sums(vec2(0.), vec2(0.));
  // Even inactive / absent invocations load tiles and reach both barriers.
  for (var base = 0u; base < count; base += 64u) {
    let sourceIndex = base + lid.x;
    tile[lid.x] = vec4(0., 0., 0., 1.);
    if (sourceIndex < count) { tile[lid.x] = positions[sourceIndex]; }
    workgroupBarrier();
    if (i < count && p.w <= 0.5) {
      for (var slot = 0u; slot < min(64u, count - base); slot++) {
        if (i != base + slot) { sums = addPair(p.xy, tile[slot], randomDir, sums); }
      }
    }
    workgroupBarrier();
  }
  if (i < count) {
    forces[i] = vec4(0.);
    if (p.w <= 0.5) { forces[i] = finishForce(sums, randomDir); }
  }
}
