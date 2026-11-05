struct DrawParameters {
  count: u32,
  stride: u32,
  _padding0: u32,
  _padding1: u32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<storage, read> positions: array<vec2f>;
@group(0) @binding(1) var<uniform> parameters: DrawParameters;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let index = min(vertexIndex * parameters.stride, parameters.count - 1u);
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(0.79, 0.81, 0.85, 0.72);
}
