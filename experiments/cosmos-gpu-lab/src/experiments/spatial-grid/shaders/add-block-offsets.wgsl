struct Parameters {
  count: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32,
}

@group(0) @binding(0) var<storage, read_write> offsets: array<u32>;
@group(0) @binding(1) var<storage, read> blockOffsets: array<u32>;
@group(0) @binding(2) var<uniform> parameters: Parameters;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;
  if (index >= parameters.count) {
    return;
  }
  offsets[index] = offsets[index] + blockOffsets[index / 256u];
}
