#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D sourceTexture;
uniform sampler2D targetTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform interpolatePositionUniforms {
  float progress;
} interpolatePosition;

#define progress interpolatePosition.progress
#else
uniform float progress;
#endif

in vec2 textureCoords;

out vec4 fragColor;

void main() {
  vec4 source = texture(sourceTexture, textureCoords);
  vec4 target = texture(targetTexture, textureCoords);
  vec2 position = mix(source.rg, target.rg, progress);
  fragColor = vec4(position, source.b, 1.0);
}
