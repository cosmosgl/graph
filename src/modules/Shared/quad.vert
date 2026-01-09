#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 vertexCoord; // Vertex coordinates in normalized device coordinates
out vec2 textureCoords; // Texture coordinates to pass to the fragment shader

void main() {
    // Convert vertex coordinates from [-1, 1] range to [0, 1] range for texture sampling
    textureCoords = (vertexCoord + 1.0) / 2.0;
    gl_Position = vec4(vertexCoord, 0, 1);
}
