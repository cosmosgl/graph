#version 300 es
precision highp float;

uniform sampler2D positionsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform calculateCentermassUniforms {
  float pointsTextureSize;
} calculateCentermass;

#define pointsTextureSize calculateCentermass.pointsTextureSize
#else
uniform float pointsTextureSize;
#endif

in vec2 pointIndices;

out vec4 rgba;

void main() {
  vec4 pointPosition = texture(positionsTexture, pointIndices / pointsTextureSize);
  // Additive blend accumulates: [sum(x), sum(y), count, sum(z)].
  // z lives in the position alpha channel and is 0 in 2D mode.
  rgba = vec4(pointPosition.xy, 1.0, pointPosition.a);

  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
