struct Parameters {
  count: u32,
  _padding0: u32,
  _padding1: u32,
  _padding2: u32,
}

@group(0) @binding(0) var<storage, read_write> positions: array<vec2f>;
@group(0) @binding(1) var<uniform> parameters: Parameters;

fn hash(value: u32) -> u32 {
  var result = value;
  result ^= result >> 16u;
  result *= 0x7feb352du;
  result ^= result >> 15u;
  result *= 0x846ca68bu;
  result ^= result >> 16u;
  return result;
}

fn coordinate(value: u32) -> f32 {
  return f32(hash(value)) / 4294967295.0 * 1.8 - 0.9;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3u) {
  let index = globalId.x;
  if (index >= parameters.count) {
    return;
  }
  positions[index] = vec2f(
    coordinate(index * 2u + 0x9e3779b9u),
    coordinate(index * 2u + 1u + 0x9e3779b9u),
  );
}
