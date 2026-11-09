#version 300 es
layout(location = 0) in vec2 position;
layout(std140) uniform drawUniforms { float pointSize; vec4 color; };

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  gl_PointSize = pointSize;
}
