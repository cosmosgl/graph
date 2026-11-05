struct Parameters {
  pointCount: u32,
  gridSize: u32,
  cellCount: u32,
  padding: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> cursors: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> pointIndices: array<u32>;
@group(0) @binding(3) var<uniform> parameters: Parameters;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let pointIndex = globalId.x;
  if (pointIndex >= parameters.pointCount) {
    return;
  }

  let normalized = clamp(
    positions[pointIndex] * 0.5 + vec2<f32>(0.5),
    vec2<f32>(0.0),
    vec2<f32>(0.99999994),
  );
  let cell = vec2<u32>(normalized * f32(parameters.gridSize));
  let cellIndex = cell.y * parameters.gridSize + cell.x;
  let destination = atomicAdd(&cursors[cellIndex], 1u);
  pointIndices[destination] = pointIndex;
}
