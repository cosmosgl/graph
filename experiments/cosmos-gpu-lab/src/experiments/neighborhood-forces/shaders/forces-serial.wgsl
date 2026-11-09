// Historical serial control, used only by the precision investigation. Do not use as the default kernel.
struct Parameters {
  count: u32,
  gridSize: u32,
  radius: f32,
  strength: f32,
  dt: f32,
  damping: f32,
  diagnosticIndex: u32,
  padding: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> forces: array<vec4f>;
@group(0) @binding(2) var<uniform> params: Parameters;
@group(0) @binding(3) var<storage, read> offsets: array<u32>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;

fn contribution(p: vec2f, q: vec2f, i: u32, j: u32) -> vec3f {
  if (i == j) { return vec3f(0.0); }
  let delta = p - q;
  let squared = dot(delta, delta);
  if (squared >= params.radius * params.radius) { return vec3f(0.0); }
  let distance = sqrt(squared);
  if (distance <= 0.000001) {
    // A deterministic antisymmetric fallback avoids NaNs at coincidence.
    return vec3f(select(1.0, -1.0, i < j), 0.0, 1.0);
  }
  return vec3f(delta * ((1.0 - distance / params.radius) / distance), 1.0);
}

var<workgroup> tile: array<vec2f, 128>;

@compute @workgroup_size(128)
fn brute(@builtin(global_invocation_id) global: vec3u, @builtin(local_invocation_id) local: vec3u) {
  let i = global.x;
  var p = vec2f(0.0);
  if (i < params.count) { p = positions[i]; }
  var sum = vec3f(0.0);
  // Even inactive lanes participate in both barriers for the final partial tile.
  for (var start = 0u; start < params.count; start += 128u) {
    let j = start + local.x;
    tile[local.x] = vec2f(0.0);
    if (j < params.count) { tile[local.x] = positions[j]; }
    workgroupBarrier();
    if (i < params.count) {
      for (var k = 0u; k < min(128u, params.count - start); k++) {
        sum += contribution(p, tile[k], i, start + k);
      }
    }
    workgroupBarrier();
  }
  if (i < params.count) { forces[i] = vec4f(sum.xy * params.strength, sum.z, f32(params.count - 1u)); }
}

@compute @workgroup_size(128)
fn grid(@builtin(global_invocation_id) global: vec3u) {
  let i = global.x;
  if (i >= params.count) { return; }
  let p = positions[i];
  let normalized = clamp(p * 0.5 + vec2f(0.5), vec2f(0.0), vec2f(0.99999994));
  let cell = vec2i(normalized * f32(params.gridSize));
  let reach = i32(ceil(params.radius * f32(params.gridSize) * 0.5));
  let first = max(vec2i(0), cell - vec2i(reach));
  let last = min(vec2i(i32(params.gridSize) - 1), cell + vec2i(reach));
  var sum = vec3f(0.0);
  var candidates = 0u;
  for (var y = first.y; y <= last.y; y++) {
    for (var x = first.x; x <= last.x; x++) {
      let c = u32(y) * params.gridSize + u32(x);
      for (var cursor = offsets[c]; cursor < offsets[c + 1u]; cursor++) {
        let j = indices[cursor];
        sum += contribution(p, positions[j], i, j);
        if (i != j) { candidates++; }
      }
    }
  }
  forces[i] = vec4f(sum.xy * params.strength, sum.z, f32(candidates));
}

// Capture individual contributions for one target, in flattened grid/scatter order.
@group(0) @binding(5) var<storage, read_write> capturedContributions: array<vec4f>;
@compute @workgroup_size(128)
fn captureContributions(@builtin(global_invocation_id) global: vec3u) {
  let cursor = global.x;
  if (cursor >= params.count) { return; }
  let j = indices[cursor];
  let p = positions[params.diagnosticIndex];
  let q = positions[j];
  let a = vec2i(clamp(p * 0.5 + vec2f(0.5), vec2f(0.0), vec2f(0.99999994)) * f32(params.gridSize));
  let b = vec2i(clamp(q * 0.5 + vec2f(0.5), vec2f(0.0), vec2f(0.99999994)) * f32(params.gridSize));
  let reach = i32(ceil(params.radius * f32(params.gridSize) * 0.5));
  let visited = all(abs(a - b) <= vec2i(reach));
  capturedContributions[cursor] = vec4f(contribution(p, q, params.diagnosticIndex, j), select(0.0, 1.0, visited));
}
