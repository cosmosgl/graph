#version 300 es
layout(location = 0) in vec2 position;
uniform float pointSize;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  gl_PointSize = pointSize;
}
