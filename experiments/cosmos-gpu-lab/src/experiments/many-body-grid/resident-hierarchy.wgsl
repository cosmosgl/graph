// The spatial index includes absent points in an arbitrary cell so that it is
// still a permutation of all target IDs. They do not contribute to the grid.
struct Params { count: u32, finest: u32, slotCount: u32, seed: u32, outputOffset: u32, childOffset: u32, childSize: u32, unused: u32 }
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> offsets: array<u32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> aggregates: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> slots: array<vec2f>;
@group(0) @binding(5) var<uniform> params: Params;

fn pointHash(i: u32) -> f32 {
  var h = i ^ params.seed;
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  let fraction = (f32(h >> 8u) + 0.5) / 16777216.;
  let scaled = fraction * 0.998;
  return 0.001 + scaled;
}

@compute @workgroup_size(64)
fn fine(@builtin(global_invocation_id) gid: vec3u) {
  let cell = gid.x; let cells = params.finest * params.finest;
  if (cell >= cells) { return; }
  var bestHash: array<f32, 8>; var bestPoint: array<u32, 8>;
  for (var s = 0u; s < 8u; s++) { bestHash[s] = 1.; bestPoint[s] = 0xffffffffu; }
  var sum = vec4f(0.);
  for (var cursor = offsets[cell]; cursor < offsets[cell + 1u]; cursor++) {
    let index = indices[cursor]; let point = positions[index];
    if (point.w > 0.5) { continue; }
    sum += vec4f(point.xy, 1., 0.);
    let h = pointHash(index);
    for (var s = 0u; s < params.slotCount; s++) {
      if (h == bestHash[s]) { bestPoint[s] = min(bestPoint[s], index); break; }
      if (h < bestHash[s]) {
        var j = params.slotCount - 1u;
        while (j > s) { bestHash[j] = bestHash[j - 1u]; bestPoint[j] = bestPoint[j - 1u]; j--; }
        bestHash[s] = h; bestPoint[s] = index; break;
      }
    }
  }
  aggregates[params.outputOffset + cell] = sum;
  for (var s = 0u; s < params.slotCount; s++) {
    let index = bestPoint[s];
    slots[s * cells + cell] = vec2f(select(f32(index), -1., index == 0xffffffffu), bestHash[s]);
  }
}

@compute @workgroup_size(64)
fn parent(@builtin(global_invocation_id) gid: vec3u) {
  let n = params.childSize / 2u; let cell = gid.x;
  if (cell >= n * n) { return; }
  let x = (cell % n) * 2u; let y = (cell / n) * 2u;
  let child = params.childOffset + y * params.childSize + x;
  aggregates[params.outputOffset + cell] = aggregates[child] + aggregates[child + 1u] +
    aggregates[child + params.childSize] + aggregates[child + params.childSize + 1u];
}
