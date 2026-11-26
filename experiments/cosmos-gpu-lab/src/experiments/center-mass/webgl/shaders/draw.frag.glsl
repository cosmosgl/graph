#version 300 es
precision highp float;
layout(std140) uniform drawUniforms { float pointSize; vec4 color; };
layout(location = 0) out vec4 fragmentColor;

void main() {
  fragmentColor = color;
}
