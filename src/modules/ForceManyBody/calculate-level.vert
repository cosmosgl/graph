#version 300 es
precision highp float;

// Aggregates each point into its grid cell. A level is a plain 2D grid of
// `levelGridSize` cells per axis rendered one texel per cell; additive blending
// accumulates [sum(x), sum(y), count, 0] per cell via calculate-level.frag.

uniform sampler2D positionsTexture;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform calculateLevelsPreciseUniforms {
  float pointsTextureSize;
  float levelGridSize;
  float cellSize;
} calculateLevelsPrecise;

#define pointsTextureSize calculateLevelsPrecise.pointsTextureSize
#define levelGridSize calculateLevelsPrecise.levelGridSize
#define cellSize calculateLevelsPrecise.cellSize
#else
uniform float pointsTextureSize;
uniform float levelGridSize;
uniform float cellSize;
#endif

in vec2 pointIndices;

out vec4 vColor;

void main() {
  vColor = vec4(0.0);

  // Absent points must not enter the grid — a NaN position bins to a NaN cell and
  // poisons the centermass that drives repulsion for every point. (exit.G = absent)
  vec4 exitStatus = texture(exitTexture, (pointIndices + 0.5) / pointsTextureSize);
  if (exitStatus.g > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);
  vColor = vec4(pointPosition.rg, 1.0, 0.0);

  // The clamp must match the force shaders exactly, or boundary points fall out
  // of the level decomposition's exactly-once coverage.
  int gridSize = int(levelGridSize);
  ivec2 cell = clamp(ivec2(floor(pointPosition.rg / cellSize)), ivec2(0), ivec2(gridSize - 1));

  vec2 levelPosition = 2.0 * (vec2(cell) + 0.5) / levelGridSize - 1.0;
  gl_Position = vec4(levelPosition, 0.0, 1.0);
  gl_PointSize = 1.0;
}
