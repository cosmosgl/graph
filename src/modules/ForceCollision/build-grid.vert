#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform buildGridUniforms {
  float pointsTextureSize;
  float gridTextureSize;   // Cells per axis
  float cellSize;
  float tilesPerRow;        // 3D only: z-slices per texture row (tiled layout)
  float gridTextureWidth;   // 3D only: tiled texture dimensions in pixels
  float gridTextureHeight;
  vec3 gridOffset;          // Offset for multi-pass (0-1 range, multiplied by cellSize)
} buildGrid;

#define pointsTextureSize buildGrid.pointsTextureSize
#define gridTextureSize buildGrid.gridTextureSize
#define cellSize buildGrid.cellSize
#define tilesPerRow buildGrid.tilesPerRow
#define gridTextureWidth buildGrid.gridTextureWidth
#define gridTextureHeight buildGrid.gridTextureHeight
#define gridOffset buildGrid.gridOffset
#else
uniform float pointsTextureSize;
uniform float gridTextureSize;
uniform float cellSize;
uniform float tilesPerRow;
uniform float gridTextureWidth;
uniform float gridTextureHeight;
uniform vec3 gridOffset;
#endif

in vec2 pointIndices;

// 2D: xy = position sum, z = size sum, w = count
// 3D: xyz = position sum, w = count (the force pass approximates neighbor radii
// with the reading point's own radius — no channel is left for a size sum)
out vec4 cellData;

void main() {
  vec4 pointPosition = texture(positionsTexture, pointIndices / pointsTextureSize);

#ifdef SPACE_3D
  // The position texture stores z in the alpha channel
  vec3 position = vec3(pointPosition.xy, pointPosition.a);
  cellData = vec4(position, 1.0);

  // Apply grid offset for multi-pass collision detection
  vec3 offsetPosition = position + gridOffset * cellSize;

  int gridSize = int(gridTextureSize);
  ivec3 cell = clamp(ivec3(floor(offsetPosition / cellSize)), ivec3(0), ivec3(gridSize - 1));

  // z-slices are tiled into a 2D texture (same layout as the octree levels)
  int rowTiles = int(tilesPerRow);
  ivec2 pixel = ivec2(
    (cell.z % rowTiles) * gridSize + cell.x,
    (cell.z / rowTiles) * gridSize + cell.y
  );
  vec2 gridPosition = 2.0 * (vec2(pixel) + 0.5) / vec2(gridTextureWidth, gridTextureHeight) - 1.0;
#else
  // Output: position sum, size sum, count
  vec4 pointSize = texture(sizeTexture, pointIndices / pointsTextureSize);
  cellData = vec4(pointPosition.xy, pointSize.r, 1.0);

  // Apply grid offset for multi-pass collision detection
  vec2 offsetPosition = pointPosition.xy + gridOffset.xy * cellSize;

  // Calculate which grid cell this point belongs to
  float cellX = floor(offsetPosition.x / cellSize);
  float cellY = floor(offsetPosition.y / cellSize);

  // Clamp to grid bounds
  cellX = clamp(cellX, 0.0, gridTextureSize - 1.0);
  cellY = clamp(cellY, 0.0, gridTextureSize - 1.0);

  // Convert to clip space coordinates
  vec2 gridPosition = 2.0 * (vec2(cellX, cellY) + 0.5) / gridTextureSize - 1.0;
#endif

  gl_Position = vec4(gridPosition, 0.0, 1.0);
  gl_PointSize = 1.0;
}
