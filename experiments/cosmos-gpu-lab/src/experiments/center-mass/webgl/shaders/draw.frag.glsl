#version 300 es
precision highp float;
uniform vec4 color;
layout(location = 0) out vec4 fragmentColor;

void main() {
  fragmentColor = color;
}
