#version 300 es
#ifdef GL_ES
precision highp float;
#endif

// Fills the screen-space picking buffer: every point rasterizes its sprite at
// its projected screen position, carrying [index, x, y] to the fragment shader.
// Hover detection then only reads a small window of this buffer under the
// cursor — it never has to touch the point set again until the scene changes
// (see Points.updatePickingBuffer / Graph.findHoveredItem).
//
// The two-pass highlight priority mirrors the draw order: greyed first, then
// highlighted (top-most wins), since later points overwrite earlier ones with
// the depth test off.

in vec2 pointIndices;
in float size;
in float imageSize;

uniform sampler2D positionsTexture;
uniform sampler2D pointStatus;
uniform sampler2D exitTexture;

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
  float pointDefaultSize;
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
#define pointDefaultSize fillPickingBuffer.pointDefaultSize
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
uniform float pointDefaultSize;
#endif

out vec4 rgba;

// Keep tiny points pickable: below this sprite footprint (in picking-buffer
// pixels) a point could fall between the buffer's texels.
const float minPickingSize = 2.0;

// Must stay identical to calculatePointSize in draw-points.vert (same
// transform-scale semantics), or the picking radius drifts from the rendered
// point size.
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

  vec2 uv = (pointIndices + 0.5) / pointsTextureSize;

  // Skip absent (faded-out) points so hover never lands on a removed one. Their
  // size/position may still look hittable mid-fade (only alpha faded), so the exit
  // status is the reliable signal. exit.G = current absence.
  vec4 exitStatus = texture(exitTexture, uv);
  if (exitStatus.g > 0.5) return;

  vec4 greyoutStatus = texture(pointStatus, uv);
  float isHighlighted = (greyoutStatus.r == 0.0) ? 1.0 : 0.0;

  if (skipHighlighted > 0.0 && isHighlighted > 0.0) return;
  if (skipGreyed > 0.0 && isHighlighted <= 0.0) return;

  vec4 pointPosition = texture(positionsTexture, uv);
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

  // Resolve a NaN size at read time. The absent-point guard above already returned,
  // so a NaN here means "use the config default".
  float resolvedSize = isnan(size) ? pointDefaultSize : size;

  float shapeSizeValue = calculatePointSize(resolvedSize * sizeScale, pxPerUnit);
  float imageSizeValue = calculatePointSize(imageSize * sizeScale, pxPerUnit);
  // Device px → CSS px → picking-buffer px (the buffer is smaller than the screen)
  float spriteSize = max(shapeSizeValue, imageSizeValue) / ratio * pickingPixelRatio;

  float index = pointIndices.g * pointsTextureSize + pointIndices.r;
  rgba = vec4(index, pointPosition.rg, 0.0);
  gl_PointSize = max(spriteSize, minPickingSize);
  // 2D: later points overwrite earlier ones (depth test off), matching draw order.
  gl_Position = vec4(ndc, 0.0, 1.0);
}
