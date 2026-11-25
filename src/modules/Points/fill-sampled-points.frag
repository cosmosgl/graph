#version 300 es
precision highp sampler2D;
#ifdef GL_ES
precision highp float;
#endif

in vec4 rgba;

out vec4 fragColor;

void main() {
  fragColor = rgba;
}