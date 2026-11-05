struct Parameters {
  pointCount: u32,
  gridSize: u32,
  cellCount: u32,
  padding: u32,
}

@group(0) @binding(0) var<storage, read_write> offsets: array<u32>;
@group(0) @binding(1) var<uniform> parameters: Parameters;

@compute @workgroup_size(1)
fn main() {
  offsets[parameters.cellCount] = parameters.pointCount;
}
