#version 300 es
#ifdef GL_ES
precision highp float;
#endif

// Fills the screen-space picking buffer: every point rasterizes its sprite at
// its projected screen position, carrying [index, x, y, z] to the fragment
// shader. Hover detection then only reads a small window of this buffer under
// the cursor — it never has to touch the point set again until the scene
// changes (see Points.updatePickingBuffer / Graph.findHoveredItem).
//
// In 3D candidates depth-test against each other so the nearest point wins;
// the two-pass highlight priority mirrors find-hovered semantics: the
// highlighted pass gets the nearer half of the depth range, so it beats the
// greyed pass, matching the two-pass draw order in 2D (greyed first).

in vec2 pointIndices;
in float size;
in float imageSize;

uniform sampler2D positionsTexture;
uniform sampler2D pointStatus;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform fillPickingBufferUniforms {
  float pointsTextureSize;
  float sizeScale;
  float spaceSize;
  vec2 screenSize;
  float ratio;
  float pickingPixelRatio;
  mat4 transformationMatrix;
  float scalePointsOnZoom;
  float maxPointSize;
  float skipHighlighted;
  float skipGreyed;
} fillPickingBuffer;

#define pointsTextureSize fillPickingBuffer.pointsTextureSize
#define sizeScale fillPickingBuffer.sizeScale
#define spaceSize fillPickingBuffer.spaceSize
#define screenSize fillPickingBuffer.screenSize
#define ratio fillPickingBuffer.ratio
#define pickingPixelRatio fillPickingBuffer.pickingPixelRatio
#define transformationMatrix fillPickingBuffer.transformationMatrix
#define scalePointsOnZoom fillPickingBuffer.scalePointsOnZoom
#define maxPointSize fillPickingBuffer.maxPointSize
#define skipHighlighted fillPickingBuffer.skipHighlighted
#define skipGreyed fillPickingBuffer.skipGreyed
#else
uniform float pointsTextureSize;
uniform float sizeScale;
uniform float spaceSize;
uniform vec2 screenSize;
uniform float ratio;
uniform float pickingPixelRatio;
uniform mat3 transformationMatrix;
uniform float scalePointsOnZoom;
uniform float maxPointSize;
uniform float skipHighlighted;
uniform float skipGreyed;
#endif

out vec4 rgba;

// Keep tiny points pickable: below this sprite footprint (in picking-buffer
// pixels) a point could fall between the buffer's texels.
const float minPickingSize = 2.0;

// Must stay identical to calculatePointSize in draw-points.vert (same `pxPerUnit`
// semantics), or the picking radius drifts from the rendered point size.
float calculatePointSize(float size, float pxPerUnit) {
  float pSize;

  if (scalePointsOnZoom > 0.0) {
    pSize = size * ratio * pxPerUnit;
  } else {
    pSize = size * ratio * min(5.0, max(1.0, pxPerUnit * 0.01));
  }

  return min(pSize, maxPointSize * ratio);
}

void main() {
  // Fully clipped: a skipped point must not rasterize anywhere in the buffer.
  rgba = vec4(-1.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 1.0;

  vec4 greyoutStatus = texture(pointStatus, (pointIndices + 0.5) / pointsTextureSize);
  float isHighlighted = (greyoutStatus.r == 0.0) ? 1.0 : 0.0;

  if (skipHighlighted > 0.0 && isHighlighted > 0.0) return;
  if (skipGreyed > 0.0 && isHighlighted <= 0.0) return;

  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);

  #ifdef SPACE_3D
  // 3D mode: same projection as draw-points.vert (z in the texture's alpha channel).
  vec4 clip = transformationMatrix * vec4(pointPosition.rg, pointPosition.a, 1.0);
  if (clip.w <= 0.0) return; // behind the camera — never a pick candidate
  float pxPerUnit = pxPerSpaceUnit(transformationMatrix, screenSize, clip.w);
  vec2 ndc = clip.xy / clip.w;
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
  vec2 ndc = finalPosition.xy;
  #endif

  float shapeSizeValue = calculatePointSize(size * sizeScale, pxPerUnit);
  float imageSizeValue = calculatePointSize(imageSize * sizeScale, pxPerUnit);
  // Device px → CSS px → picking-buffer px (the buffer is smaller than the screen)
  float spriteSize = max(shapeSizeValue, imageSizeValue) / ratio * pickingPixelRatio;

  float index = pointIndices.g * pointsTextureSize + pointIndices.r;
  rgba = vec4(index, pointPosition.rg, pointPosition.a);
  gl_PointSize = max(spriteSize, minPickingSize);

  #ifdef SPACE_3D
  // Nearest-wins: candidates depth-test against each other. The highlighted
  // pass (skipGreyed == 1) gets the nearer half of the depth range so it keeps
  // priority over the greyed pass, matching the 2D two-pass order.
  float depth01 = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  float priority = (skipHighlighted > 0.0) ? 0.5 : 0.0;
  gl_Position = vec4(ndc, (priority + 0.5 * depth01) * 2.0 - 1.0, 1.0);
  #else
  // 2D: later points overwrite earlier ones (depth test off), matching draw order.
  gl_Position = vec4(ndc, 0.0, 1.0);
  #endif
}
