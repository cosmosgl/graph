struct Params { count: f32, strength: f32, radius: f32, padding: f32, maxRadius: f32, alpha: f32, cooling: f32, pad: f32 }
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> sizes: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read_write> forces: array<vec4f>;
fn radius(size: f32) -> f32 { return springAdd(select(springMul(size, 0.5), params.radius, params.radius > 0.), params.padding); }
fn square(v: vec2f) -> f32 { return springAdd(springMul(v.x, v.x), springMul(v.y, v.y)); }
fn collisionDirection(index: u32) -> vec2f {
  let angle = springMul(f32(index), 2.399963229728653);
  // The production golden angle grows with index. Reduce the stored f32
  // angle in high/low arithmetic before using the existing small-angle helper.
  let turns = round(angle * 0.15915494309189535);
  var reduced = sub_fp64(vec2f(angle, 0.), mul_fp64(vec2f(turns, 0.), vec2f(6.2831854820251465, -1.7484555314695172e-7)));
  reduced = sub_fp64(reduced, vec2f(-6.860498040023527e-15 * turns, 0.));
  let sc = gravitySinCos(reduced);
  return vec2f(sc.cosine.x, sc.sine.x);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x; if (index >= u32(params.count)) { return; }
  let point = positions[index];
  if (point.w > 0.5) { forces[index] = vec4f(0.); return; }
  let ownRadius = radius(sizes[index]); let ownSquare = springMul(ownRadius, ownRadius);
  let reject = springAdd(ownRadius, params.maxRadius); let rejectSquare = springMul(reject, reject);
  var correction = vec2f(0.);
  for (var other = 0u; other < u32(params.count); other++) {
    if (other == index) { continue; }
    let source = positions[other];
    // Skip absent sentinels before arithmetic; this also preserves finite
    // positions of faded-out points as non-blocking sources.
    if (source.w > 0.5) { continue; }
    let delta = vec2f(springSub(point.x, source.x), springSub(point.y, source.y));
    let dist2 = square(delta); if (!(dist2 < rejectSquare)) { continue; }
    let otherRadius = radius(sizes[other]); let contact = springAdd(ownRadius, otherRadius);
    if (dist2 >= springMul(contact, contact)) { continue; }
    var distance = springRoot(dist2); var direction: vec2f;
    if (distance > 1e-4) { direction = vec2f(springDiv(delta.x, distance), springDiv(delta.y, distance)); }
    else { direction = collisionDirection(index); distance = 0.; }
    let otherSquare = springMul(otherRadius, otherRadius);
    let weight = springDiv(springMul(springSub(contact, distance), otherSquare), springAdd(ownSquare, otherSquare));
    correction = vec2f(springAdd(correction.x, springMul(direction.x, weight)), springAdd(correction.y, springMul(direction.y, weight)));
  }
  var cooling = 1.;
  if (params.cooling > 0.) {
    let alpha = max(params.alpha, 0.);
    cooling = pow(alpha, params.cooling);
    if (params.cooling == 0.5) { cooling = springRoot(alpha); }
    if (params.cooling == 1.) { cooling = alpha; }
    if (params.cooling == 2.) { cooling = springMul(alpha, alpha); }
  }
  let strength = springMul(params.strength, cooling);
  correction = vec2f(springMul(correction.x, strength), springMul(correction.y, strength));
  let speed = springRoot(square(correction));
  if (speed > ownRadius) {
    let scale = springDiv(ownRadius, speed);
    correction = vec2f(springMul(correction.x, scale), springMul(correction.y, scale));
  }
  forces[index] = vec4f(correction, 0., 0.);
}
