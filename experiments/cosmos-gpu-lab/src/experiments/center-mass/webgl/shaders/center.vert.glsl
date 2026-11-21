#version 300 es
layout(location = 0) in vec2 position;
out vec2 pointPosition;

void main() {
  pointPosition = position;
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
