#version 300 es
precision highp float;

in vec4 rgba;
out vec4 fragColor;

void main() {
  fragColor = rgba;
}