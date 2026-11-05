struct VertexOutput {
  @builtin(position) position: vec4f,
}

@vertex
fn vertexMain(@location(0) position: vec2f) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(0.76, 0.82, 0.91, 0.88);
}
