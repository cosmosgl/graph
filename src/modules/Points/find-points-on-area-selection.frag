#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D positionsTexture;
uniform sampler2D pointSize;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform findPointsOnAreaSelectionUniforms {
  float sizeScale;
  float spaceSize;
  vec2 screenSize;
  float ratio;
  mat4 transformationMatrix;
  vec2 selection0;
  vec2 selection1;
  float scalePointsOnZoom;
  float maxPointSize;
} findPointsOnAreaSelection;

#define sizeScale findPointsOnAreaSelection.sizeScale
#define spaceSize findPointsOnAreaSelection.spaceSize
#define screenSize findPointsOnAreaSelection.screenSize
#define ratio findPointsOnAreaSelection.ratio
#define transformationMatrix findPointsOnAreaSelection.transformationMatrix
#define selection0 findPointsOnAreaSelection.selection0
#define selection1 findPointsOnAreaSelection.selection1
#define scalePointsOnZoom findPointsOnAreaSelection.scalePointsOnZoom
#define maxPointSize findPointsOnAreaSelection.maxPointSize
#else
uniform float sizeScale;
uniform float spaceSize;
uniform vec2 screenSize;
uniform float ratio;
uniform mat3 transformationMatrix;
uniform vec2 selection0;
uniform vec2 selection1;
uniform float scalePointsOnZoom;
uniform float maxPointSize;
#endif

in vec2 textureCoords;

out vec4 fragColor;

float pointSizeF(float size) {
  float pSize;
  // Extract top-left element from mat4 (or use mat3 conversion)
  #ifdef USE_UNIFORM_BUFFERS
  float scale = transformationMatrix[0][0]; // mat4 first element
  #else
  float scale = transformationMatrix[0][0]; // mat3 first element
  #endif
  if (scalePointsOnZoom > 0.0) { 
    pSize = size * ratio * scale;
  } else {
    pSize = size * ratio * min(5.0, max(1.0, scale * 0.01));
  }
  return min(pSize, maxPointSize * ratio);
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec2 p = 2.0 * pointPosition.rg / spaceSize - 1.0;
  p *= spaceSize / screenSize;
  #ifdef USE_UNIFORM_BUFFERS
  // Convert mat4 to mat3 for vec3 multiplication
  mat3 transformMat3 = mat3(transformationMatrix);
  vec3 final = transformMat3 * vec3(p, 1);
  #else
  vec3 final = transformationMatrix * vec3(p, 1);
  #endif

  vec4 pSize = texture(pointSize, textureCoords);
  float size = pSize.r * sizeScale;

  float left = 2.0 * (selection0.x - 0.5 * pointSizeF(size)) / screenSize.x - 1.0;
  float right = 2.0 * (selection1.x + 0.5 * pointSizeF(size)) / screenSize.x - 1.0;
  float top =  2.0 * (selection0.y - 0.5 * pointSizeF(size)) / screenSize.y - 1.0;
  float bottom =  2.0 * (selection1.y + 0.5 * pointSizeF(size)) / screenSize.y - 1.0;

  fragColor = vec4(0.0, 0.0, pointPosition.r, pointPosition.g);
  if (final.x >= left && final.x <= right && final.y >= top && final.y <= bottom) {
    fragColor.r = 1.0;
  }
}

