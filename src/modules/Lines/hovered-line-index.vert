#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 vertexCoord;

void main() {
  gl_Position = vec4(vertexCoord, 0.0, 1.0);
} 