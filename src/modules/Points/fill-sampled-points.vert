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
  float index = pointIndices.g * pointsTextureSize + pointIndices.r;

  #ifdef SPACE_3D
  // 3D mode: project with the camera's view-projection matrix (z in the texture's
  // alpha channel). The second channel carries z instead of the constant validity
  // flag — validity is index >= 0 (the pass clears the FBO to -1).
  vec4 clip = transformationMatrix * vec4(pointPosition.rg, pointPosition.a, 1.0);
  if (clip.w <= 0.0) {
    // Behind the camera — keep the vertex off the sampling grid.
    rgba = vec4(-1.0);
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }
  vec2 pointScreenPosition = (clip.xy / clip.w + 1.0) * screenSize / 2.0;
  rgba = vec4(index, pointPosition.a, pointPosition.xy);
  #else
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
  rgba = vec4(index, 1.0, pointPosition.xy);
  #endif

  float i = (pointScreenPosition.x + 0.5) / screenSize.x;
  float j = (pointScreenPosition.y + 0.5) / screenSize.y;
  gl_Position = vec4(2.0 * vec2(i, j) - 1.0, 0.0, 1.0);

  gl_PointSize = 1.0;
}