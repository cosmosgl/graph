#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 vertexCoord;

uniform sampler2D positionsTexture;
uniform sampler2D pointStatus;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform drawHighlightedUniforms {
  float sourceSize;
  float targetSize;
  float imageSize;
  mat4 transformationMatrix;
  float pointsTextureSize;
  float sizeScale;
  float spaceSize;
  vec2 screenSize;
  float scalePointsOnZoom;
  float pointIndex;
  float maxPointSize;
  vec4 color;
  float universalPointOpacity;
  float greyoutOpacity;
  float isDarkenGreyout;
  vec4 backgroundColor;
  vec4 greyoutColor;
  float animatePositions;
  float transitionProgress;
  float animateSizes;
  float pointDefaultSize;
  float width;
  float pixelRatio;
} drawHighlighted;

#define sourceSize drawHighlighted.sourceSize
#define targetSize drawHighlighted.targetSize
#define imageSize drawHighlighted.imageSize
#define pixelRatio drawHighlighted.pixelRatio
#define transformationMatrix drawHighlighted.transformationMatrix
#define pointsTextureSize drawHighlighted.pointsTextureSize
#define sizeScale drawHighlighted.sizeScale
#define spaceSize drawHighlighted.spaceSize
#define screenSize drawHighlighted.screenSize
#define scalePointsOnZoom drawHighlighted.scalePointsOnZoom
#define pointIndex drawHighlighted.pointIndex
#define maxPointSize drawHighlighted.maxPointSize
#define color drawHighlighted.color
#define universalPointOpacity drawHighlighted.universalPointOpacity
#define greyoutOpacity drawHighlighted.greyoutOpacity
#define isDarkenGreyout drawHighlighted.isDarkenGreyout
#define backgroundColor drawHighlighted.backgroundColor
#define greyoutColor drawHighlighted.greyoutColor
#define animatePositions drawHighlighted.animatePositions
#define transitionProgress drawHighlighted.transitionProgress
#define animateSizes drawHighlighted.animateSizes
#define pointDefaultSize drawHighlighted.pointDefaultSize
#else
uniform float sourceSize;
uniform float targetSize;
uniform float imageSize;
uniform mat3 transformationMatrix;
uniform float pointsTextureSize;
uniform float sizeScale;
uniform float spaceSize;
uniform vec2 screenSize;
uniform float scalePointsOnZoom;
uniform float pointIndex;
uniform float maxPointSize;
uniform vec4 color;
uniform float universalPointOpacity;
uniform float greyoutOpacity;
uniform float isDarkenGreyout;
uniform vec4 backgroundColor;
uniform vec4 greyoutColor;
uniform float animatePositions;
uniform float transitionProgress;
uniform float animateSizes;
uniform float pointDefaultSize;
uniform float width;
uniform float pixelRatio;
#endif
out vec2 vertexPosition;
out float pointOpacity;
out vec3 rgbColor;
// Ring outer radius and quad half-size, device px: the ring plus a full ramp per side.
flat out float ringRadiusPx;
flat out float quadHalfPx;

// The drawn size (draw-points.vert), so the ring follows it. The sizes are uniforms here.
float calculatePointSize(float pointSize) {
  return pointSizePx(pointSize, pixelRatio, transformationMatrix[0][0], scalePointsOnZoom, maxPointSize);
}

void main () {
  vertexPosition = vertexCoord;

  int pointTexSize = int(pointsTextureSize);
  int pointLinearIndex = int(pointIndex);
  // Integer % and / are undefined on a negative or zero operand, and pointIndex
  // defaults to -1 (no point highlighted). Nothing to draw in that case anyway.
  if (pointLinearIndex < 0 || pointTexSize <= 0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  ivec2 pointTexel = ivec2(pointLinearIndex % pointTexSize, pointLinearIndex / pointTexSize);

  // Exit ramp (exit-ramp.glsl), the sprite's: drop the ring only once the point is fully
  // gone, so it stays on the body while that fades out or in.
  float exit = exitRamp(texelFetch(exitTexture, pointTexel, 0), animatePositions, transitionProgress);
  if (exit >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);

  rgbColor = color.rgb;
  pointOpacity = color.a * universalPointOpacity;
  vec4 greyoutStatus = texelFetch(pointStatus, pointTexel, 0);
  if (greyoutStatus.r > 0.0) {
    if (greyoutColor[0] != -1.0) {
      rgbColor = greyoutColor.rgb;
      pointOpacity = greyoutColor.a;
    } else {
      // If greyoutColor is not set, make color lighter or darker based on isDarkenGreyout
      float blendFactor = 0.65; // Controls how much to modify (0.0 = original, 1.0 = target color)
      
      if (isDarkenGreyout > 0.0) {
        // Darken the color
        rgbColor = mix(rgbColor, vec3(0.2), blendFactor);
      } else {
        // Lighten the color
        rgbColor = mix(rgbColor, max(backgroundColor.rgb, vec3(0.8)), blendFactor);
      }
    }

    if (greyoutOpacity != -1.0) {
      pointOpacity *= greyoutOpacity;
    }
  }

  // The sprite's footprint this frame: its size by the shared rule (exit-ramp.glsl), and
  // the image size (0 for a point without an image) when larger.
  float pointSize = transitionedSize(sourceSize, targetSize, animateSizes, transitionProgress, exit, pointDefaultSize);
  float footprint = max(calculatePointSize(pointSize * sizeScale), calculatePointSize(imageSize * sizeScale));

  // A size of 0 draws nothing (draw-points.vert culls the sprite), so it has no ring; the
  // quad below is never narrower than the ramp.
  if (footprint <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // Ring radius from the drawn core, device px: a shape under a device pixel is drawn as one.
  ringRadiusPx = max(footprint, 1.0) * POINT_RING_SCALE * 0.5;
  quadHalfPx = ringRadiusPx + EDGE_RAMP_PX;
  float radius = quadHalfPx / pixelRatio / transformationMatrix[0][0];

  // Calculate point position in screen space
  vec2 a = pointPosition.xy;
  vec2 b = pointPosition.xy + vec2(0.0, radius);
  vec2 xBasis = b - a;
  vec2 yBasis = normalize(vec2(-xBasis.y, xBasis.x));
  vec2 pointPositionInScreenSpace = a + xBasis * vertexCoord.x + yBasis * radius * vertexCoord.y;

  // Transform point position to normalized device coordinates
  vec2 p = 2.0 * pointPositionInScreenSpace / spaceSize - 1.0;
  p *= spaceSize / screenSize;
  #ifdef USE_UNIFORM_BUFFERS
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 final = transformMat3 * vec3(p, 1);
  #else
  vec3 final = transformationMatrix * vec3(p, 1);
  #endif
  
  gl_Position = vec4(final.rg, 0, 1);
}