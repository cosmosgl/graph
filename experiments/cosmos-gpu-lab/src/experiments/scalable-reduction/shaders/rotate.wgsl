struct Parameters {
  count: u32,
  _padding0: u32,
  _padding1: u32,
  _padding2: u32,
}

@group(0) @binding(0) var<storage, read_write> positions: array<vec2f>;
@group(0) @binding(1) var<uniform> parameters: Parameters;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3u) {
  let index = globalId.x;
  if (index >= parameters.count) {
    return;
  }
  let point = positions[index];
  let cosine = 0.999998;
  let sine = 0.0019999987;
  positions[index] = vec2f(
    point.x * cosine - point.y * sine,
    point.x * sine + point.y * cosine,
  );
}
