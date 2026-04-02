#version 300 es
#ifdef GL_ES
precision highp float;
#endif

in vec2 pointIndices;
in float size;
in vec4 color;
in float shape;
in float imageIndex;
in float imageSize;

uniform sampler2D positionsTexture;
uniform sampler2D pointStatus;
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
#endif

out float pointShape;
out float isGreyedOut;
out float isOutlined;
out vec4 shapeColor;
out vec4 imageAtlasUV;
out float shapeSize;
out float imageSizeVarying;
out float overallSize;

float calculatePointSize(float size) {
  float pSize;

  if (scalePointsOnZoom > 0.0) {
    pSize = size * ratio * transformationMatrix[0][0];
  } else {
    pSize = size * ratio * min(5.0, max(1.0, transformationMatrix[0][0] * 0.01));
  }

  return min(pSize, maxPointSize * ratio);
}

const float outlineRingScale = 1.3;

void main() {
  // Read point status texture: R = greyout, G = outlined
  vec4 status = texture(pointStatus, (pointIndices + 0.5) / pointsTextureSize);
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

  // Position
  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);
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
  gl_Position = vec4(finalPosition.rg, 0, 1);

  // Calculate sizes for shape and image
  float shapeSizeValue = calculatePointSize(size * sizeScale);
  float imageSizeValue = calculatePointSize(imageSize * sizeScale);

  // Use the larger of the two sizes for the overall point size
  float overallSizeValue = max(shapeSizeValue, imageSizeValue);

  // Scale up point to fit outline ring
  if (isOutlined > 0.0) {
    overallSizeValue *= outlineRingScale;
  }

  gl_PointSize = overallSizeValue;

  // Pass size information to fragment shader
  shapeSize = shapeSizeValue;
  imageSizeVarying = imageSizeValue;
  overallSize = overallSizeValue;

  shapeColor = color;
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
    float atlasCoordIndex = imageIndex;
    float texX = mod(atlasCoordIndex, imageAtlasCoordsTextureSize);
    float texY = floor(atlasCoordIndex / imageAtlasCoordsTextureSize);
    vec2 atlasCoordTexCoord = (vec2(texX, texY) + 0.5) / imageAtlasCoordsTextureSize;
    vec4 atlasCoords = texture(imageAtlasCoords, atlasCoordTexCoord);
    imageAtlasUV = atlasCoords;
  }
  #else
  if (hasImages <= 0.0 || imageIndex < 0.0 || imageIndex >= imageCount) {
    imageAtlasUV = vec4(-1.0);
  } else {
    float atlasCoordIndex = imageIndex;
    float texX = mod(atlasCoordIndex, imageAtlasCoordsTextureSize);
    float texY = floor(atlasCoordIndex / imageAtlasCoordsTextureSize);
    vec2 atlasCoordTexCoord = (vec2(texX, texY) + 0.5) / imageAtlasCoordsTextureSize;
    vec4 atlasCoords = texture(imageAtlasCoords, atlasCoordTexCoord);
    imageAtlasUV = atlasCoords;
  }
  #endif
}
