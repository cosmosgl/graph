#version 300 es
precision highp float;

// One depth-peeling pass of the near-field point-slot build.
//
// The octree's near field needs actual point-to-point forces (cell centroids
// alone exert a purely radial force that flattens dense hubs into disks and
// spikes). Each peeling pass selects, per finest-level cell, the not-yet-peeled
// point with the smallest per-tick random hash: the depth test keeps the
// smallest `hashValue` among eligible points, and eligibility excludes points
// already captured by the previous slot (hash <= previous slot's hash). Running
// K passes yields a uniform random K-subset per cell, re-randomized every tick
// via `randomSeed`; force-nearfield-3d.frag turns it into an unbiased estimate
// of the cell's exact all-pairs repulsion (Monte-Carlo P3M).

uniform sampler2D positionsTexture;
uniform sampler2D previousSlot;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform buildNearFieldSlotsUniforms {
  float pointsTextureSize;
  float levelGridSize;
  float cellSize;
  float tilesPerRow;
  float levelTextureWidth;
  float levelTextureHeight;
  float hasPreviousSlot;
  float randomSeed;
} buildNearFieldSlots;

#define pointsTextureSize buildNearFieldSlots.pointsTextureSize
#define levelGridSize buildNearFieldSlots.levelGridSize
#define cellSize buildNearFieldSlots.cellSize
#define tilesPerRow buildNearFieldSlots.tilesPerRow
#define levelTextureWidth buildNearFieldSlots.levelTextureWidth
#define levelTextureHeight buildNearFieldSlots.levelTextureHeight
#define hasPreviousSlot buildNearFieldSlots.hasPreviousSlot
#define randomSeed buildNearFieldSlots.randomSeed
#else
uniform float pointsTextureSize;
uniform float levelGridSize;
uniform float cellSize;
uniform float tilesPerRow;
uniform float levelTextureWidth;
uniform float levelTextureHeight;
uniform float hasPreviousSlot;
uniform float randomSeed;
#endif

in vec2 pointIndices;

out vec2 slotData; // [point index, hash]

void main() {
  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);
  vec3 position = vec3(pointPosition.rg, pointPosition.a);
  float index = pointIndices.y * pointsTextureSize + pointIndices.x;

  // Per-tick random ordering; kept strictly inside (0, 1) so the depth range is safe.
  float hashValue = fract(sin(index * 12.9898 + randomSeed * 78.233) * 43758.5453);
  hashValue = 0.001 + hashValue * 0.998;

  // Must match the cell formula of the aggregation and force shaders exactly.
  int gridSize = int(levelGridSize);
  ivec3 cell = clamp(ivec3(floor(position / cellSize)), ivec3(0), ivec3(gridSize - 1));
  int rowTiles = int(tilesPerRow);
  ivec2 pixel = ivec2(
    (cell.z % rowTiles) * gridSize + cell.x,
    (cell.z / rowTiles) * gridSize + cell.y
  );

  if (hasPreviousSlot > 0.5) {
    vec2 previous = texelFetch(previousSlot, pixel, 0).rg;
    // Eligible only if the previous slot captured a point with a smaller hash.
    // An empty previous slot (index -1) means the cell is exhausted — otherwise
    // this pass would re-capture already-peeled points and double-count them.
    if (previous.x < 0.0 || hashValue <= previous.y) {
      slotData = vec2(-1.0, 1.0);
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 1.0;
      return;
    }
  }

  slotData = vec2(index, hashValue);
  vec2 ndc = 2.0 * (vec2(pixel) + 0.5) / vec2(levelTextureWidth, levelTextureHeight) - 1.0;
  // The depth test (less) keeps the eligible point with the smallest hash.
  gl_Position = vec4(ndc, hashValue * 2.0 - 1.0, 1.0);
  gl_PointSize = 1.0;
}
