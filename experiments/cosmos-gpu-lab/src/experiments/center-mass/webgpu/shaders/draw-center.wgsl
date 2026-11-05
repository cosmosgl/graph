struct CenterUniforms {
  center: vec2f,
  pixelSize: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: CenterUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-4.0, -4.0), vec2f(4.0, -4.0), vec2f(-4.0, 4.0),
    vec2f(-4.0, 4.0), vec2f(4.0, -4.0), vec2f(4.0, 4.0),
  );
  var output: VertexOutput;
  output.position = vec4f(uniforms.center + corners[vertexIndex] * uniforms.pixelSize, 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(1.0, 0.32, 0.24, 1.0);
}
