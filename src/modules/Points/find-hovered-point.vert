#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 pointIndices;
in float size;

uniform sampler2D positionsTexture;
uniform sampler2D pointGreyoutStatus;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform findHoveredPointUniforms {
  float pointsTextureSize;
  float sizeScale;
  float spaceSize;
  vec2 screenSize;
  float ratio;
  mat4 transformationMatrix;
  vec2 mousePosition;
  float scalePointsOnZoom;
  float maxPointSize;
  float skipSelected;
  float skipUnselected;
} findHoveredPoint;

#define pointsTextureSize findHoveredPoint.pointsTextureSize
#define sizeScale findHoveredPoint.sizeScale
#define spaceSize findHoveredPoint.spaceSize
#define screenSize findHoveredPoint.screenSize
#define ratio findHoveredPoint.ratio
#define transformationMatrix findHoveredPoint.transformationMatrix
#define mousePosition findHoveredPoint.mousePosition
#define scalePointsOnZoom findHoveredPoint.scalePointsOnZoom
#define maxPointSize findHoveredPoint.maxPointSize
#define skipSelected findHoveredPoint.skipSelected
#define skipUnselected findHoveredPoint.skipUnselected
#else
uniform float pointsTextureSize;
uniform float sizeScale;
uniform float spaceSize;
uniform vec2 screenSize;
uniform float ratio;
uniform mat3 transformationMatrix;
uniform vec2 mousePosition;
uniform float scalePointsOnZoom;
uniform float maxPointSize;
uniform float skipSelected;
uniform float skipUnselected;
#endif

out vec4 rgba;

float calculatePointSize(float size) {
  float pSize;

  if (scalePointsOnZoom > 0.0) { 
    pSize = size * ratio * transformationMatrix[0][0];
  } else {
    pSize = size * ratio * min(5.0, max(1.0, transformationMatrix[0][0] * 0.01));
  }

  return min(pSize, maxPointSize * ratio);
}

float euclideanDistance (float x1, float x2, float y1, float y2) {
  return sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
}

void main() {
  vec4 greyoutStatus = texture(pointGreyoutStatus, (pointIndices + 0.5) / pointsTextureSize);
  float isSelected = (greyoutStatus.r == 0.0) ? 1.0 : 0.0;

  if (skipSelected > 0.0 && isSelected > 0.0) {
    rgba = vec4(0.0);
    gl_Position = vec4(0.5, 0.5, 0.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }
  if (skipUnselected > 0.0 && isSelected <= 0.0) {
    rgba = vec4(0.0);
    gl_Position = vec4(0.5, 0.5, 0.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }

  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);
  vec2 point = pointPosition.rg;

  vec2 normalizedPosition = 2.0 * point / spaceSize - 1.0;
  normalizedPosition *= spaceSize / screenSize;
  
  #ifdef USE_UNIFORM_BUFFERS
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 finalPosition = transformMat3 * vec3(normalizedPosition, 1);
  #else
  vec3 finalPosition = transformationMatrix * vec3(normalizedPosition, 1);
  #endif

  float pointRadius = 0.5 * calculatePointSize(size * sizeScale);
  vec2 pointScreenPosition = (finalPosition.xy + 1.0) * screenSize / 2.0;
  
  rgba = vec4(0.0);
  gl_Position = vec4(0.5, 0.5, 0.0, 1.0);
  
  if (euclideanDistance(pointScreenPosition.x, mousePosition.x, pointScreenPosition.y, mousePosition.y) < pointRadius / ratio) {
    float index = pointIndices.g * pointsTextureSize + pointIndices.r;
    rgba = vec4(index, size, pointPosition.xy);
    gl_Position = vec4(-0.5, -0.5, 0.0, 1.0);
  }

  gl_PointSize = 1.0;
}