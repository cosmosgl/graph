#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D pointSize;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform findPointsInRectUniforms {
  float sizeScale;
  float spaceSize;
  vec2 screenSize;
  float ratio;
  mat4 transformationMatrix;
  vec2 rect0;
  vec2 rect1;
  float scalePointsOnZoom;
  float maxPointSize;
} findPointsInRect;

#define sizeScale findPointsInRect.sizeScale
#define spaceSize findPointsInRect.spaceSize
#define screenSize findPointsInRect.screenSize
#define ratio findPointsInRect.ratio
#define transformationMatrix findPointsInRect.transformationMatrix
#define rect0 findPointsInRect.rect0
#define rect1 findPointsInRect.rect1
#define scalePointsOnZoom findPointsInRect.scalePointsOnZoom
#define maxPointSize findPointsInRect.maxPointSize
#else
uniform float sizeScale;
uniform float spaceSize;
uniform vec2 screenSize;
uniform float ratio;
uniform mat3 transformationMatrix;
uniform vec2 rect0;
uniform vec2 rect1;
uniform float scalePointsOnZoom;
uniform float maxPointSize;
#endif

out vec4 fragColor;

// The drawn size (draw-points.vert), so the selection footprint is the rendered point: a shape
// under a device pixel is drawn as one. In CSS px, the units of the rectangle and screenSize.
float pointSizeF(float size) {
  return max(pointSizePx(size, ratio, transformationMatrix[0][0], scalePointsOnZoom, maxPointSize), 1.0) / ratio;
}

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  // Skip absent (faded-out) points — never select a removed point. exit.G = absent.
  if (texelFetch(exitTexture, pointTexel, 0).g > 0.5) {
    fragColor = vec4(0.0);
    return;
  }

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec2 p = 2.0 * pointPosition.rg / spaceSize - 1.0;
  p *= spaceSize / screenSize;
  #ifdef USE_UNIFORM_BUFFERS
  // Convert mat4 to mat3 for vec3 multiplication
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 final = transformMat3 * vec3(p, 1);
  #else
  vec3 final = transformationMatrix * vec3(p, 1);
  #endif

  vec4 pSize = texelFetch(pointSize, pointTexel, 0);
  float size = pSize.r * sizeScale;
  // A size of 0 draws nothing (draw-points.vert), so it is not selectable either.
  if (size <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  float left = 2.0 * (rect0.x - 0.5 * pointSizeF(size)) / screenSize.x - 1.0;
  float right = 2.0 * (rect1.x + 0.5 * pointSizeF(size)) / screenSize.x - 1.0;
  float top =  2.0 * (rect0.y - 0.5 * pointSizeF(size)) / screenSize.y - 1.0;
  float bottom =  2.0 * (rect1.y + 0.5 * pointSizeF(size)) / screenSize.y - 1.0;

  fragColor = vec4(0.0, 0.0, pointPosition.r, pointPosition.g);
  if (final.x >= left && final.x <= right && final.y >= top && final.y <= bottom) {
    fragColor.r = 1.0;
  }
}

