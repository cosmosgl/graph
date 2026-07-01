#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 pointIndices;
in float size;
in float imageSize;

uniform sampler2D positionsTexture;
uniform sampler2D pointStatus;

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
  float skipHighlighted;
  float skipGreyed;
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
#define skipHighlighted findHoveredPoint.skipHighlighted
#define skipGreyed findHoveredPoint.skipGreyed
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
uniform float skipHighlighted;
uniform float skipGreyed;
#endif

out vec4 rgba;

// Must stay identical to calculatePointSize in draw-points.vert (same `pxPerUnit`
// semantics), or the hover radius drifts from the rendered point size.
float calculatePointSize(float size, float pxPerUnit) {
  float pSize;

  if (scalePointsOnZoom > 0.0) {
    pSize = size * ratio * pxPerUnit;
  } else {
    pSize = size * ratio * min(5.0, max(1.0, pxPerUnit * 0.01));
  }

  return min(pSize, maxPointSize * ratio);
}

float euclideanDistance (float x1, float x2, float y1, float y2) {
  return sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
}

void main() {
  vec4 greyoutStatus = texture(pointStatus, (pointIndices + 0.5) / pointsTextureSize);
  float isHighlighted = (greyoutStatus.r == 0.0) ? 1.0 : 0.0;

  if (skipHighlighted > 0.0 && isHighlighted > 0.0) {
    rgba = vec4(-1.0);
    gl_Position = vec4(0.5, 0.5, 0.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }
  if (skipGreyed > 0.0 && isHighlighted <= 0.0) {
    rgba = vec4(-1.0);
    gl_Position = vec4(0.5, 0.5, 0.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }

  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);

  #ifdef SPACE_3D
  // 3D mode: same projection as draw-points.vert (z in the texture's alpha channel).
  vec4 clip = transformationMatrix * vec4(pointPosition.rg, pointPosition.a, 1.0);
  if (clip.w <= 0.0) {
    // Behind the camera — never a hover candidate.
    rgba = vec4(-1.0);
    gl_Position = vec4(0.5, 0.5, 0.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }
  float pxPerUnit = pxPerSpaceUnit(transformationMatrix, screenSize, clip.w);
  vec2 pointScreenPosition = (clip.xy / clip.w + 1.0) * screenSize / 2.0;
  #else
  vec2 point = pointPosition.rg;

  vec2 normalizedPosition = 2.0 * point / spaceSize - 1.0;
  normalizedPosition *= spaceSize / screenSize;

  #ifdef USE_UNIFORM_BUFFERS
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 finalPosition = transformMat3 * vec3(normalizedPosition, 1);
  #else
  vec3 finalPosition = transformationMatrix * vec3(normalizedPosition, 1);
  #endif
  float pxPerUnit = transformationMatrix[0][0];
  vec2 pointScreenPosition = (finalPosition.xy + 1.0) * screenSize / 2.0;
  #endif

  float shapeSizeValue = calculatePointSize(size * sizeScale, pxPerUnit);
  float imageSizeValue = calculatePointSize(imageSize * sizeScale, pxPerUnit);
  float pointRadius = 0.5 * max(shapeSizeValue, imageSizeValue);

  rgba = vec4(-1.0);
  gl_Position = vec4(0.5, 0.5, 0.0, 1.0);

  if (euclideanDistance(pointScreenPosition.x, mousePosition.x, pointScreenPosition.y, mousePosition.y) < pointRadius / ratio) {
    float index = pointIndices.g * pointsTextureSize + pointIndices.r;
    #ifdef SPACE_3D
    // 3D packing: [index, x, y, z] — size is derivable from the index on the CPU,
    // and validity is signalled by index >= 0 instead.
    rgba = vec4(index, pointPosition.rg, pointPosition.a);
    // Nearest-wins: encode depth into z (the hovered FBO has a depth attachment in
    // 3D). The highlighted pass (skipGreyed == 1) gets the nearer half of the depth
    // range so it keeps priority over the greyed pass, matching the 2D two-pass order.
    float depth01 = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
    float priority = (skipHighlighted > 0.0) ? 0.5 : 0.0;
    gl_Position = vec4(-0.5, -0.5, (priority + 0.5 * depth01) * 2.0 - 1.0, 1.0);
    #else
    rgba = vec4(index, max(size, imageSize), pointPosition.xy);
    gl_Position = vec4(-0.5, -0.5, 0.0, 1.0);
    #endif
  }

  gl_PointSize = 1.0;
}