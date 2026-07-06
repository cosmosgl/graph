#version 300 es
precision highp float;

uniform sampler2D positionsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform calculateLevelsUniforms {
  float pointsTextureSize;
  float levelTextureSize;
  float cellSize;
} calculateLevels;

#define pointsTextureSize calculateLevels.pointsTextureSize
#define levelTextureSize calculateLevels.levelTextureSize
#define cellSize calculateLevels.cellSize
#else
uniform float pointsTextureSize;
uniform float levelTextureSize;
uniform float cellSize;
#endif

in vec2 pointIndices;

out vec4 vColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);
  vColor = vec4(pointPosition.rg, 1.0, 0.0);

  float n = floor(pointPosition.x / cellSize);
  float m = floor(pointPosition.y / cellSize);

  // Positions are clamped to [0, spaceSize] inclusive, so a point sitting
  // exactly on the far boundary bins to cell == levelTextureSize, which lies
  // outside clip space and would be dropped from every level (the point would
  // stop repelling anything). Clamp to the last cell instead.
  n = clamp(n, 0.0, levelTextureSize - 1.0);
  m = clamp(m, 0.0, levelTextureSize - 1.0);

  vec2 levelPosition = 2.0 * (vec2(n, m) + 0.5) / levelTextureSize - 1.0;

  gl_Position = vec4(levelPosition, 0.0, 1.0);
  gl_PointSize = 1.0;
}