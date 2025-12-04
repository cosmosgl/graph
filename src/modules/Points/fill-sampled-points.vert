#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 pointIndices;

uniform sampler2D positionsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform fillSampledPointsUniforms {
  float pointsTextureSize;
  mat4 transformationMatrix;
  float spaceSize;
  vec2 screenSize;
} fillSampledPoints;

#define pointsTextureSize fillSampledPoints.pointsTextureSize
#define transformationMatrix fillSampledPoints.transformationMatrix
#define spaceSize fillSampledPoints.spaceSize
#define screenSize fillSampledPoints.screenSize
#else
uniform float pointsTextureSize;
uniform float spaceSize;
uniform vec2 screenSize;
uniform mat3 transformationMatrix;
#endif

out vec4 rgba;

void main() {
  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);
  vec2 p = 2.0 * pointPosition.rg / spaceSize - 1.0;
  p *= spaceSize / screenSize;
  #ifdef USE_UNIFORM_BUFFERS
  // Convert mat4 to mat3 for vec3 multiplication
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 final = transformMat3 * vec3(p, 1);
  #else
  vec3 final = transformationMatrix * vec3(p, 1);
  #endif

  vec2 pointScreenPosition = (final.xy + 1.0) * screenSize / 2.0;
  float index = pointIndices.g * pointsTextureSize + pointIndices.r;
  rgba = vec4(index, 1.0, pointPosition.xy);
  float i = (pointScreenPosition.x + 0.5) / screenSize.x;
  float j = (pointScreenPosition.y + 0.5) / screenSize.y;
  gl_Position = vec4(2.0 * vec2(i, j) - 1.0, 0.0, 1.0);

  gl_PointSize = 1.0;
}