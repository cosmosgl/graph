struct RenderUniforms {
  values: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
}

@group(0) @binding(0) var<storage, read> positions: array<vec2f>;
@group(0) @binding(1) var<storage, read> colors: array<vec4f>;
@group(0) @binding(2) var<uniform> uniforms: RenderUniforms;

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0),
  vec2f( 1.0, -1.0),
  vec2f(-1.0,  1.0),
  vec2f(-1.0,  1.0),
  vec2f( 1.0, -1.0),
  vec2f( 1.0,  1.0),
);

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) pointIndex: u32,
) -> VertexOutput {
  let corner = QUAD[vertexIndex];
  let diameter = uniforms.values.x;
  let viewport = uniforms.values.yz;
  let pixelToClip = vec2f(2.0 / viewport.x, 2.0 / viewport.y);

  var output: VertexOutput;
  output.position = vec4f(
    positions[pointIndex] + corner * diameter * 0.5 * pixelToClip,
    0.0,
    1.0,
  );
  output.local = corner;
  output.color = colors[pointIndex];
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let radius = length(input.local);
  let feather = max(fwidth(radius), 0.01);
  let coverage = 1.0 - smoothstep(1.0 - feather, 1.0, radius);
  if (coverage <= 0.0) { discard; }
  return vec4f(input.color.rgb, input.color.a * coverage);
}
