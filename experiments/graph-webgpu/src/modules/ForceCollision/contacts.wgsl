// Contact constraints use the same radius-weighted projection for both neighbor paths.
struct ContactParams { count: f32, strength: f32, radius: f32, padding: f32, maxRadius: f32, alpha: f32, cooling: f32, pad: f32 }
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> sizes: array<f32>;
@group(0) @binding(2) var<uniform> params: ContactParams;
@group(0) @binding(3) var<storage, read_write> forces: array<vec4f>;
@group(0) @binding(4) var<uniform> grid: CollisionGrid;
@group(0) @binding(5) var<storage, read> slots: array<u32>;

fn radius(i: u32) -> f32 { return select(sizes[i] * 0.5, params.radius, params.radius > 0.) + params.padding; }
fn contact(i: u32, other: u32, p: vec2f, r: f32) -> vec2f {
  if (other == i || positions[other].w > 0.5) { return vec2f(0.); }
  let delta = p - positions[other].xy;
  let r2 = radius(other);
  let separation = length(delta);
  if (separation >= r + r2) { return vec2f(0.); }
  var direction = vec2f(cos(f32(i) * 2.399963229728653), sin(f32(i) * 2.399963229728653));
  var dist = 0.;
  if (separation > 1e-4) { direction = delta / separation; dist = separation; }
  return direction * ((r + r2 - dist) * r2 * r2 / (r * r + r2 * r2));
}
fn finalForce(sum: vec2f, r: f32) -> vec4f {
  var v = sum * params.strength;
  if (params.cooling > 0.) { v *= pow(max(params.alpha, 0.), params.cooling); }
  let speed = length(v);
  if (speed > r && speed > 0.) { v *= r / speed; }
  return vec4f(v, 0., 0.);
}
@compute @workgroup_size(64) fn exact(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= u32(params.count)) { return; }
  let p = positions[i]; let r = radius(i); var sum = vec2f(0.);
  if (p.w < 0.5 && p.z < 0.5) {
    for (var j = 0u; j < u32(params.count); j++) { sum += contact(i, j, p.xy, r); }
  }
  forces[i] = finalForce(sum, r);
}
@compute @workgroup_size(64) fn hashed(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= u32(params.count)) { return; }
  let p = positions[i]; let r = radius(i); var sum = vec2f(0.);
  if (p.w < 0.5 && p.z < 0.5) {
    let own = collisionWorldCell(p.xy);
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let cell = own + vec2i(x,y);
        let start = collisionSlotBucket(cell) * grid.capacity;
        for (var k = 0u; k < grid.capacity; k++) {
          let slot = slots[start+k];
          if (slot == 0u) { break; }
          let j = slot - 1u;
          if (all(collisionWorldCell(positions[j].xy) == cell)) { sum += contact(i, j, p.xy, r); }
        }
      }
    }
  }
  forces[i] = finalForce(sum, r);
}
