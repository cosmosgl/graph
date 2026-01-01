#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D trackedIndices;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform trackPointsUniforms {
  float pointsTextureSize;
} trackPoints;

#define pointsTextureSize trackPoints.pointsTextureSize
#else
uniform float pointsTextureSize;
#endif

in vec2 textureCoords;

out vec4 fragColor;

void main() {
  vec4 trackedPointIndices = texture(trackedIndices, textureCoords);
  if (trackedPointIndices.r < 0.0) discard;
  vec4 pointPosition = texture(positionsTexture, (trackedPointIndices.rg + 0.5) / pointsTextureSize);

  fragColor = vec4(pointPosition.rg, 1.0, 1.0);
}

