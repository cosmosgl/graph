#version 300 es
precision highp sampler2D;
#ifdef GL_ES
precision highp float;
#endif

in vec2 vertexCoord; // Vertex coordinates in normalized device coordinates

void main() {
    gl_Position = vec4(vertexCoord, 0, 1);
}
