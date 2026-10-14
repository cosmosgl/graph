#version 300 es
precision highp float;

// Aggregates each point into its grid cell. A level is a plain 2D grid of
// `levelGridSize` cells per axis over this tick's data bounds, rendered one
// texel per cell; additive blending accumulates [sum(x), sum(y), count, 0] per
// cell via calculate-level.frag.

uniform sampler2D positionsTexture;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform calculateLevelsPreciseUniforms {
  float levelGridSize;
} calculateLevelsPrecise;

#define levelGridSize calculateLevelsPrecise.levelGridSize
#else
uniform float levelGridSize;
#endif

// @grid-cell

in vec2 pointIndices;

out vec4 vColor;

void main() {
  vColor = vec4(0.0);

  ivec2 pointTexel = ivec2(pointIndices);

  // Absent points must not enter the grid — a NaN position bins to a NaN cell and
  // poisons the centermass that drives repulsion for every point. (exit.G = absent)
  vec4 exitStatus = texelFetch(exitTexture, pointTexel, 0);
  if (exitStatus.g > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vColor = vec4(pointPosition.rg, 1.0, 0.0);

  // The shared cell formula (grid-cell.ts): the force shaders must bin every
  // point exactly as the aggregation does, or it falls out of the level
  // decomposition's exactly-once coverage.
  ivec2 cell = gridCell(pointPosition.rg, levelGridSize);

  vec2 levelPosition = 2.0 * (vec2(cell) + 0.5) / levelGridSize - 1.0;
  gl_Position = vec4(levelPosition, 0.0, 1.0);
  gl_PointSize = 1.0;
}
