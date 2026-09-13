#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 pointIndices;
in float sourceSize;
in float targetSize;
in vec4 sourceColor;
in vec4 targetColor;
in float shape;
in float imageIndex;
in float imageSize;

uniform sampler2D positionsTexture;
uniform sampler2D pointStatus;
uniform sampler2D exitTexture;
uniform sampler2D imageAtlasCoords;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform drawVertexUniforms {
  float ratio;
  mat4 transformationMatrix;
  float pointsTextureSize;
  float sizeScale;
  float spaceSize;
  vec2 screenSize;
  vec4 greyoutColor;
  vec4 backgroundColor;
  float scalePointsOnZoom;
  float maxPointSize;
  float isDarkenGreyout;
  float skipHighlighted;
  float skipGreyed;
  float hasImages;
  float imageCount;
  float imageAtlasCoordsTextureSize;
  float transitionProgress;
  float animateColors;
  float animateSizes;
  float animatePositions;
  vec4 pointDefaultColor;
  float pointDefaultSize;
  float pointsNumber;
} drawVertex;

#define ratio drawVertex.ratio
#define transformationMatrix drawVertex.transformationMatrix
#define pointsTextureSize drawVertex.pointsTextureSize
#define sizeScale drawVertex.sizeScale
#define spaceSize drawVertex.spaceSize
#define screenSize drawVertex.screenSize
#define greyoutColor drawVertex.greyoutColor
#define backgroundColor drawVertex.backgroundColor
#define scalePointsOnZoom drawVertex.scalePointsOnZoom
#define maxPointSize drawVertex.maxPointSize
#define isDarkenGreyout drawVertex.isDarkenGreyout
#define skipHighlighted drawVertex.skipHighlighted
#define skipGreyed drawVertex.skipGreyed
#define hasImages drawVertex.hasImages
#define imageCount drawVertex.imageCount
#define imageAtlasCoordsTextureSize drawVertex.imageAtlasCoordsTextureSize
#define transitionProgress drawVertex.transitionProgress
#define animateColors drawVertex.animateColors
#define animateSizes drawVertex.animateSizes
#define animatePositions drawVertex.animatePositions
#define pointDefaultColor drawVertex.pointDefaultColor
#define pointDefaultSize drawVertex.pointDefaultSize
#define pointsNumber drawVertex.pointsNumber
#else
uniform float ratio;
uniform mat3 transformationMatrix;
uniform float pointsTextureSize;
uniform float sizeScale;
uniform float spaceSize;
uniform vec2 screenSize;
uniform vec4 greyoutColor;
uniform vec4 backgroundColor;
uniform float scalePointsOnZoom;
uniform float maxPointSize;
uniform float isDarkenGreyout;
uniform float skipHighlighted;
uniform float skipGreyed;
uniform float hasImages;
uniform float imageCount;
uniform float imageAtlasCoordsTextureSize;
uniform float transitionProgress;
uniform float animateColors;
uniform float animateSizes;
uniform float animatePositions;
uniform vec4 pointDefaultColor;
uniform float pointDefaultSize;
uniform float pointsNumber;
#endif

out float pointShape;
out float isGreyedOut;
out float isOutlined;
out vec4 shapeColor;
out vec4 imageAtlasUV;
out float shapeSize;
out float imageSizeVarying;
out float overallSize;

// The size rule is the shared pointSize module, so drawing, picking and selection agree on it.
float calculatePointSize(float size) {
  return pointSizePx(size, ratio, transformationMatrix[0][0], scalePointsOnZoom, maxPointSize);
}

// Read-time resolution of NaN channels — input arrays are used verbatim and never
// edited, so "use the default" stays encoded as NaN all the way to the GPU. A NaN
// resolves to the config default blended toward the exit default along the animated
// exit ramp (0 = present, 1 = gone), so the enter/exit fade of default-valued
// channels drives itself — no size/color transition needed for a removal. Explicit
// (real) values pass through. EXIT_DEFAULT_* are #defines injected from variables.ts,
// shared with the CPU resolvers (GraphData.getResolvedPoint*).
float resolveSize(float size, float exitRamp) {
  if (!isnan(size)) return size;
  return mix(pointDefaultSize, EXIT_DEFAULT_SIZE, exitRamp);
}

vec4 resolveColor(vec4 color, float exitRamp) {
  vec4 defaultColor = mix(pointDefaultColor, vec4(EXIT_DEFAULT_COLOR_CHANNEL), exitRamp);
  return mix(color, defaultColor, isnan(color));
}

void main() {
  ivec2 pointTexel = ivec2(pointIndices);

  // Read point status texture: R = greyout, G = outlined
  vec4 status = texelFetch(pointStatus, pointTexel, 0);
  isGreyedOut = status.r;
  isOutlined = status.g;
  float isHighlighted = (status.r == 0.0) ? 1.0 : 0.0;

  // Discard point based on rendering mode
  if (skipHighlighted > 0.0 && isHighlighted > 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  if (skipGreyed > 0.0 && isHighlighted <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // Exit texture: R = previous absence, G = current absence (1 = absent). During a
  // position transition, blend R→G to animate the enter/exit; otherwise use G (the
  // settled current absence) so an unrelated color/size transition can't replay the
  // ramp. The caller drives the visual fade via setPointSizes/setPointColors; here
  // we only remove the point once it is fully gone.
  vec4 exitStatus = texelFetch(exitTexture, pointTexel, 0);
  float exit = animatePositions > 0.0
    ? mix(exitStatus.r, exitStatus.g, transitionProgress)
    : exitStatus.g;
  if (exit >= 1.0) {
    // Fully gone — skip. Also avoids using a NaN position on the snapped path.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // Position
  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec2 point = pointPosition.rg;

  // Transform point position to normalized device coordinates
  // Convert from space coordinates [0, spaceSize] to normalized [-1, 1]
  vec2 normalizedPosition = 2.0 * point / spaceSize - 1.0;

  // Apply aspect ratio correction - this is needed to map the square space to the rectangular screen
  // The transformation matrix handles zoom/pan, but we need this to handle aspect ratio
  normalizedPosition *= spaceSize / screenSize;

  #ifdef USE_UNIFORM_BUFFERS
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 finalPosition = transformMat3 * vec3(normalizedPosition, 1);
  #else
  vec3 finalPosition = transformationMatrix * vec3(normalizedPosition, 1);
  #endif
  // Depth encodes stacking order: higher point index = drawn on top = nearer
  // (smaller z). Harmless when depth testing is off (depthCompare 'always').
  float linearIndex = pointIndices.y * pointsTextureSize + pointIndices.x;
  float depthZ = 1.0 - 2.0 * (linearIndex + 0.5) / max(pointsNumber, 1.0);
  gl_Position = vec4(finalPosition.rg, depthZ, 1.0);

  // Resolve NaN channels against the animated exit ramp before mixing — default
  // sizes/colors of an entering or leaving point fade with the ramp regardless of
  // whether a size/color transition is active.
  float pointSize = animateSizes > 0.0
    ? mix(resolveSize(sourceSize, exit), resolveSize(targetSize, exit), transitionProgress)
    : resolveSize(targetSize, exit);
  vec4 pointColor = animateColors > 0.0
    ? mix(resolveColor(sourceColor, exit), resolveColor(targetColor, exit), transitionProgress)
    : resolveColor(targetColor, exit);


  // Calculate sizes for shape and image
  float shapeSizeValue = calculatePointSize(pointSize * sizeScale);
  float imageSizeValue = calculatePointSize(imageSize * sizeScale);

  // A size of 0 draws nothing; the sprite below is never smaller than a pixel.
  if (max(shapeSizeValue, imageSizeValue) <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // Use the larger of the shape, image, and 1-pixel minimum. The sprite is the shape's own size:
  // the ramp stays centred on the edge, and its outer half is clipped where the shape meets the
  // sprite's sides.
  float overallSizeValue = max(max(shapeSizeValue, 1.0), imageSizeValue);

  // Outlined: scale the drawn core (a shape is never under a pixel) to the ring size, then add
  // ramp room on both sides.
  if (isOutlined > 0.0) {
    overallSizeValue = POINT_RING_SCALE * max(max(shapeSizeValue, 1.0), imageSizeValue) + 2.0 * EDGE_RAMP_PX;
  }
  // Clamp to the hardware limit; the fragment shader preserves the shape size.
  overallSizeValue = min(overallSizeValue, maxPointSize * ratio);

  gl_PointSize = overallSizeValue;

  // Pass size information to fragment shader
  shapeSize = shapeSizeValue;
  imageSizeVarying = imageSizeValue;
  overallSize = overallSizeValue;

  shapeColor = pointColor;
  pointShape = shape;

  // Adjust color of greyed-out points
  if (isGreyedOut > 0.0) {
    if (greyoutColor[0] != -1.0) {
      shapeColor = greyoutColor;
    } else {
      // If greyoutColor is not set, make color lighter or darker based on isDarkenGreyout
      float blendFactor = 0.65;

      #ifdef USE_UNIFORM_BUFFERS
      if (isDarkenGreyout > 0.0) {
        shapeColor.rgb = mix(shapeColor.rgb, vec3(0.2), blendFactor);
      } else {
        shapeColor.rgb = mix(shapeColor.rgb, max(backgroundColor.rgb, vec3(0.8)), blendFactor);
      }
      #else
      if (isDarkenGreyout > 0.0) {
        shapeColor.rgb = mix(shapeColor.rgb, vec3(0.2), blendFactor);
      } else {
        shapeColor.rgb = mix(shapeColor.rgb, max(backgroundColor.rgb, vec3(0.8)), blendFactor);
      }
      #endif
    }
  }

  #ifdef USE_UNIFORM_BUFFERS
  if (hasImages <= 0.0 || imageIndex < 0.0 || imageIndex >= imageCount) {
    imageAtlasUV = vec4(-1.0);
  } else {
    int atlasTexSize = int(imageAtlasCoordsTextureSize);
    int atlasCoordIndex = int(imageIndex);
    ivec2 atlasTexel = ivec2(atlasCoordIndex % atlasTexSize, atlasCoordIndex / atlasTexSize);
    vec4 atlasCoords = texelFetch(imageAtlasCoords, atlasTexel, 0);
    imageAtlasUV = atlasCoords;
  }
  #else
  if (hasImages <= 0.0 || imageIndex < 0.0 || imageIndex >= imageCount) {
    imageAtlasUV = vec4(-1.0);
  } else {
    int atlasTexSize = int(imageAtlasCoordsTextureSize);
    int atlasCoordIndex = int(imageIndex);
    ivec2 atlasTexel = ivec2(atlasCoordIndex % atlasTexSize, atlasCoordIndex / atlasTexSize);
    vec4 atlasCoords = texelFetch(imageAtlasCoords, atlasTexel, 0);
    imageAtlasUV = atlasCoords;
  }
  #endif
}
