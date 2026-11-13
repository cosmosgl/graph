#version 300 es
layout(location = 0) in vec2 position;
layout(location = 1) in vec4 color;

layout(std140) uniform pointUniforms { float pointDiameter; };

out vec4 pointColor;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  gl_PointSize = pointDiameter;
  pointColor = color;
}
