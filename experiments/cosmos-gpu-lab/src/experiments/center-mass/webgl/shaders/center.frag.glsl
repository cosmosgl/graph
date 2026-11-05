#version 300 es
precision highp float;
in vec2 pointPosition;
layout(location = 0) out vec4 contribution;

void main() {
  contribution = vec4(pointPosition, 1.0, 0.0);
}
