#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec4 rgba;

out vec4 fragColor;

void main() {
  if (rgba.g <= 0.0) {
    discard;
  }
  fragColor = rgba;
}