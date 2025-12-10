#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 vertexCoord;

out vec2 vTexCoord;

void main() {
  vTexCoord = (vertexCoord + 1.0) / 2.0;
  gl_Position = vec4(vertexCoord, 0.0, 1.0);
} 