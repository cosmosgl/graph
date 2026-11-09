// Experimental chunk traversal; precision-fixed baseline is preserved in forces.wgsl.
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

// Add bounded nonnegative squared-distance products with round-to-nearest, ties-to-even.
// Only used at the radius boundary: integer operations prevent multiply-add fusion.
fn addPositiveRounded(a: f32, b: f32) -> f32 {
  let aBits = bitcast<u32>(a);
  let bBits = bitcast<u32>(b);
  let high = max(aBits, bBits);
  let low = min(aBits, bBits);
  if (low == 0u) { return bitcast<f32>(high); }
  let highExponent = (high >> 23u) & 255u;
  let lowExponent = (low >> 23u) & 255u;
  var exponent = max(highExponent, 1u);
  let shift = exponent - max(lowExponent, 1u);
  let highMantissa = ((high & 0x7fffffu) | select(0u, 0x800000u, highExponent != 0u)) << 3u;
  var lowMantissa = ((low & 0x7fffffu) | select(0u, 0x800000u, lowExponent != 0u)) << 3u;
  if (shift >= 32u) {
    lowMantissa = 1u;
  } else if (shift != 0u) {
    let sticky = select(0u, 1u, (lowMantissa & ((1u << shift) - 1u)) != 0u);
    lowMantissa = (lowMantissa >> shift) | sticky;
  }
  var sum = highMantissa + lowMantissa;
  if ((sum & 0x8000000u) != 0u) {
    sum = (sum >> 1u) | (sum & 1u);
    exponent++;
  }
  var mantissa = sum >> 3u;
  let remainder = sum & 7u;
  if (remainder > 4u || (remainder == 4u && (mantissa & 1u) != 0u)) { mantissa++; }
  if (mantissa >= 0x1000000u) { mantissa >>= 1u; exponent++; }
  if (mantissa < 0x800000u) { exponent = 0u; }
  return bitcast<f32>((exponent << 23u) | (mantissa & 0x7fffffu));
}

fn contribution(p: vec2f, q: vec2f, i: u32, j: u32) -> vec3f {
  if (i == j) { return vec3f(0.0); }
  let delta = p - q;
  var squared = dot(delta, delta);
  let cutoff = params.radius * params.radius;
  if (abs(squared - cutoff) <= cutoff * 0.000001) {
    squared = addPositiveRounded(delta.x * delta.x, delta.y * delta.y);
  }
  if (squared >= cutoff) { return vec3f(0.0); }
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
      let stop = min(128u, params.count - start);
      for (var blockStart = 0u; blockStart < stop; blockStart += 64u) {
        var partial = vec3f(0.0);
        for (var k = blockStart; k < min(blockStart + 64u, stop); k++) {
          partial += contribution(p, tile[k], i, start + k);
        }
        sum += partial;
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
  // Bound the long serial accumulation chain. Keep the original traversal and cutoff.
  var partial = vec3f(0.0);
  var partialCount = 0u;
  var group = vec3f(0.0);
  var blockCount = 0u;
  for (var y = first.y; y <= last.y; y++) {
    for (var x = first.x; x <= last.x; x++) {
      let c = u32(y) * params.gridSize + u32(x);
      let end = offsets[c + 1u];
      var cursor = offsets[c];
      candidates += end - cursor;
      while (cursor < end) {
        let stop = min(end, cursor + (64u - partialCount));
        partialCount += stop - cursor;
        // Keep the same 64-contribution blocks across cell boundaries, but maintain counters outside the hot loop.
        for (; cursor < stop; cursor++) {
          let j = indices[cursor];
          partial += contribution(p, positions[j], i, j);
        }
        if (partialCount == 64u) {
          group += partial;
          partial = vec3f(0.0);
          partialCount = 0u;
          blockCount++;
          if (blockCount == 16u) {
            sum += group;
            group = vec3f(0.0);
            blockCount = 0u;
          }
        }
      }
    }
  }
  group += partial;
  sum += group;
// Every point occurs once in the grid; the visited rectangle always includes the target cell.
  forces[i] = vec4f(sum.xy * params.strength, sum.z, f32(candidates - 1u));
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
