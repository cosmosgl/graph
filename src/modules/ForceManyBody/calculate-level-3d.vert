#version 300 es
precision highp float;

// 3D analog of calculate-level.vert: aggregates each point into its octree cell.
// A level is a 3D grid of `levelGridSize` cells per axis, flattened into a 2D
// texture by tiling the z-slices in a grid of `tilesPerRow` tiles per row.
// Additive blending accumulates [sum(x), sum(y), count, sum(z)] per cell —
// the same payload layout as the ForceCenter centermass aggregation.

uniform sampler2D positionsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform calculateLevels3DUniforms {
  float pointsTextureSize;
  float levelGridSize;
  float cellSize;
  float tilesPerRow;
  float levelTextureWidth;
  float levelTextureHeight;
} calculateLevels3D;

#define pointsTextureSize calculateLevels3D.pointsTextureSize
#define levelGridSize calculateLevels3D.levelGridSize
#define cellSize calculateLevels3D.cellSize
#define tilesPerRow calculateLevels3D.tilesPerRow
#define levelTextureWidth calculateLevels3D.levelTextureWidth
#define levelTextureHeight calculateLevels3D.levelTextureHeight
#else
uniform float pointsTextureSize;
uniform float levelGridSize;
uniform float cellSize;
uniform float tilesPerRow;
uniform float levelTextureWidth;
uniform float levelTextureHeight;
#endif

in vec2 pointIndices;

out vec4 vColor;

void main() {
  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);
  // z lives in the position alpha channel
  vec3 position = vec3(pointPosition.rg, pointPosition.a);
  vColor = vec4(position.xy, 1.0, position.z);

  // The clamp must match the force shaders exactly, or edge points fall out of
  // the level decomposition's exactly-once coverage.
  int gridSize = int(levelGridSize);
  ivec3 cell = clamp(ivec3(floor(position / cellSize)), ivec3(0), ivec3(gridSize - 1));

  int rowTiles = int(tilesPerRow);
  ivec2 pixel = ivec2(
    (cell.z % rowTiles) * gridSize + cell.x,
    (cell.z / rowTiles) * gridSize + cell.y
  );

  vec2 levelPosition = 2.0 * (vec2(pixel) + 0.5) / vec2(levelTextureWidth, levelTextureHeight) - 1.0;
  gl_Position = vec4(levelPosition, 0.0, 1.0);
  gl_PointSize = 1.0;
}
