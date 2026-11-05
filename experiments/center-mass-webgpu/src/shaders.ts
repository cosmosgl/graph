export const WEBGL_CENTER_VERTEX = `#version 300 es
layout(location = 0) in vec2 position;
out vec2 pointPosition;

void main() {
  pointPosition = position;
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`

export const WEBGL_CENTER_FRAGMENT = `#version 300 es
precision highp float;
in vec2 pointPosition;
layout(location = 0) out vec4 contribution;

void main() {
  contribution = vec4(pointPosition, 1.0, 0.0);
}`

export const WEBGL_DRAW_VERTEX = `#version 300 es
layout(location = 0) in vec2 position;
uniform float pointSize;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  gl_PointSize = pointSize;
}`

export const WEBGL_DRAW_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 color;
layout(location = 0) out vec4 fragmentColor;

void main() {
  fragmentColor = color;
}`

export const WEBGPU_REDUCE_POINTS = /* wgsl */ `
struct Parameters {
  count: u32,
  _padding0: u32,
  _padding1: u32,
  _padding2: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> partials: array<vec4f>;
@group(0) @binding(2) var<uniform> parameters: Parameters;
var<workgroup> sharedValues: array<vec4f, 256>;

@compute @workgroup_size(256)
fn main(
  @builtin(global_invocation_id) globalId: vec3u,
  @builtin(local_invocation_id) localId: vec3u,
  @builtin(workgroup_id) workgroupId: vec3u,
) {
  let index = globalId.x;
  var value = vec4f(0.0);
  if (index < parameters.count) {
    value = vec4f(positions[index], 1.0, 0.0);
  }
  sharedValues[localId.x] = value;
  workgroupBarrier();

  var stride = 128u;
  loop {
    if (localId.x < stride) {
      sharedValues[localId.x] += sharedValues[localId.x + stride];
    }
    workgroupBarrier();
    if (stride == 1u) {
      break;
    }
    stride /= 2u;
  }

  if (localId.x == 0u) {
    partials[workgroupId.x] = sharedValues[0];
  }
}`

export const WEBGPU_REDUCE_PARTIALS = /* wgsl */ `
struct Parameters {
  count: u32,
  _padding0: u32,
  _padding1: u32,
  _padding2: u32,
}

@group(0) @binding(0) var<storage, read> partials: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> result: array<vec4f>;
@group(0) @binding(2) var<uniform> parameters: Parameters;
var<workgroup> sharedValues: array<vec4f, 256>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) localId: vec3u) {
  var value = vec4f(0.0);
  if (localId.x < parameters.count) {
    value = partials[localId.x];
  }
  sharedValues[localId.x] = value;
  workgroupBarrier();

  var stride = 128u;
  loop {
    if (localId.x < stride) {
      sharedValues[localId.x] += sharedValues[localId.x + stride];
    }
    workgroupBarrier();
    if (stride == 1u) {
      break;
    }
    stride /= 2u;
  }

  if (localId.x == 0u) {
    result[0] = sharedValues[0];
  }
}`

export const WEBGPU_DRAW = /* wgsl */ `
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
}`

export const WEBGPU_DRAW_CENTER = /* wgsl */ `
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
}`
