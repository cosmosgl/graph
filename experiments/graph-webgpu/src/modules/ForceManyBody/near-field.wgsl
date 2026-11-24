struct NearParams {
  count: u32, width: u32, slotCount: u32, seedBits: u32,
  alpha: f32, strength: f32, maxStep: f32, pad: f32,
}
@group(0) @binding(0) var<uniform> params: NearParams;
@group(0) @binding(1) var<storage, read> heads: array<u32>;
@group(0) @binding(2) var<storage, read> next: array<u32>;
@group(0) @binding(3) var<storage, read_write> slots: array<u32>;
@group(0) @binding(4) var<storage, read> positions: array<vec4f>;
@group(0) @binding(5) var<storage, read> samples: array<vec2f>;
@group(0) @binding(6) var<storage, read> cells: array<vec4f>;
@group(0) @binding(7) var<storage, read> box: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> forces: array<vec4f>;

@compute @workgroup_size(64)
fn selectNearSlots(@builtin(global_invocation_id) id: vec3u) {
  let bucket = id.x;
  if (bucket < params.width * params.width) {
    writeCellSlots(bucket, heads[bucket], params.slotCount, params.seedBits);
  }
}

fn pairVelocity(p: vec2f, other: vec2f, randomDir: vec2f) -> vec2f {
  var diff = p - other;
  var squared = dot(diff, diff);
  if (squared <= 0.) {
    diff = randomDir;
    squared = dot(diff, diff);
    if (squared <= 0.) { return vec2f(0.); }
  }
  if (squared < 1.) { squared = sqrt(squared); }
  return (params.alpha * params.strength / sqrt(squared)) * normalize(diff);
}

// The pyramid excludes the 3×3 block around the point on its finest grid.
// Each of those cells contributes an exact sum when it fits in the slots,
// or a random, occupancy-weighted estimate of its pair forces otherwise.
@compute @workgroup_size(64)
fn addNearRepulsion(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  let p = positions[i];
  if (p.w > 0.5 || p.z > 0.5) { return; }
  let center = vec2i(gridCell(p.xy, params.width, box[0]));
  let randomDir = samples[i];
  var velocity = vec2f(0.);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let cell = center + vec2i(x, y);
      if (any(cell < vec2i(0)) || any(cell >= vec2i(i32(params.width)))) { continue; }
      let bucket = u32(cell.y) * params.width + u32(cell.x);
      let others = cells[bucket].z - select(0., 1., x == 0 && y == 0);
      if (others <= 0.) { continue; }
      var sum = vec2f(0.);
      var sampled = 0.;
      for (var slot = 0u; slot < params.slotCount; slot++) {
        let entry = slots[bucket * params.slotCount + slot];
        if (entry == 0u) { break; }
        let neighbor = entry - 1u;
        if (neighbor == i) { continue; }
        sum += pairVelocity(p.xy, positions[neighbor].xy, randomDir);
        sampled += 1.;
      }
      if (sampled > 0.) { velocity += (others / sampled) * sum; }
    }
  }
  velocity += velocity * randomDir;
  let speed = length(velocity);
  if (speed > params.maxStep) { velocity *= params.maxStep / speed; }
  forces[i] += vec4f(velocity, 0., 0.);
}
