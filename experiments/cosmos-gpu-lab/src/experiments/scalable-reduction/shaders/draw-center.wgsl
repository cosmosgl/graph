struct CenterParameters {
  pixelSize: vec2f,
  _padding: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<storage, read> result: array<vec4f>;
@group(0) @binding(1) var<uniform> parameters: CenterParameters;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-5.0, -5.0), vec2f(5.0, -5.0), vec2f(-5.0, 5.0),
    vec2f(-5.0, 5.0), vec2f(5.0, -5.0), vec2f(5.0, 5.0),
  );
  let center = result[0].xy / result[0].z;
  var output: VertexOutput;
  output.position = vec4f(center + corners[vertexIndex] * parameters.pixelSize, 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(0.94, 0.43, 0.36, 1.0);
}
