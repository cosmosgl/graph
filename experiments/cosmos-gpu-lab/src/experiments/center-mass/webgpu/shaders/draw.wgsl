struct VertexOutput {
  @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<storage, read> positions: array<vec2f>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(0.76, 0.82, 0.91, 0.88);
}
