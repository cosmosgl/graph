#version 300 es
precision highp float;

// One octree level of 3D many-body repulsion (Barnes-Hut-style approximation).
//
// Levels are 3D grids of increasing resolution (4³, 8³, …), each flattened into a
// 2D texture of tiled z-slices holding [sum(x), sum(y), count, sum(z)] per cell.
// The decomposition tiles space exactly once across the level passes:
// after level L the only un-accumulated region is the 3³ Chebyshev-1 neighborhood
// of the point's cell, which the next level refines (its aligned 6³ child block),
// and which force-centermass-3d.frag finally covers at the finest level.
// The exclusion shell is fixed at Chebyshev distance 1 — the 2D theta parameter
// does not apply in 3D.

uniform sampler2D positionsTexture;
uniform sampler2D levelTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceLevel3DUniforms {
  float levelGridSize;
  float cellSize;
  float tilesPerRow;
  float isFirstLevel;
  float alpha;
  float repulsion;
} forceLevel3D;

#define levelGridSize forceLevel3D.levelGridSize
#define cellSize forceLevel3D.cellSize
#define tilesPerRow forceLevel3D.tilesPerRow
#define isFirstLevel forceLevel3D.isFirstLevel
#define alpha forceLevel3D.alpha
#define repulsion forceLevel3D.repulsion
#else
uniform float levelGridSize;
uniform float cellSize;
uniform float tilesPerRow;
uniform float isFirstLevel;
uniform float alpha;
uniform float repulsion;
#endif

in vec2 textureCoords;
out vec4 fragColor;

// Repulsion from one cell's center of mass — the 3D transcription of the 2D
// calculateAdditionalVelocity (same d3-style clamped inverse-distance falloff).
vec3 cellVelocity(ivec3 cell, int gridSize, int rowTiles, vec3 position) {
  ivec2 pixel = ivec2(
    (cell.z % rowTiles) * gridSize + cell.x,
    (cell.z / rowTiles) * gridSize + cell.y
  );
  vec4 centermass = texelFetch(levelTexture, pixel, 0);
  // Count-only guard: zero coordinate sums are legitimate, but dividing by a zero
  // count would produce NaN that additive blending propagates into the velocity FBO.
  if (centermass.b <= 0.0) return vec3(0.0);
  vec3 centermassPosition = vec3(centermass.r, centermass.g, centermass.a) / centermass.b;
  vec3 distVector = position - centermassPosition;
  float l = dot(distVector, distVector);
  if (l <= 0.0) return vec3(0.0);
  float distanceMin2 = 1.0;
  if (l < distanceMin2) l = sqrt(distanceMin2 * l);
  float addV = alpha * repulsion * centermass.b / sqrt(l);
  return addV * normalize(distVector);
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec3 position = vec3(pointPosition.rg, pointPosition.a);

  int gridSize = int(levelGridSize);
  int rowTiles = int(tilesPerRow);
  // Must match the aggregation shader's cell formula exactly.
  ivec3 pointCell = clamp(ivec3(floor(position / cellSize)), ivec3(0), ivec3(gridSize - 1));

  vec3 velocity = vec3(0.0);

  if (isFirstLevel > 0.5) {
    // Coarsest level: every cell except the 3³ neighborhood, which finer levels refine.
    for (int k = 0; k < gridSize; k += 1) {
      for (int j = 0; j < gridSize; j += 1) {
        for (int i = 0; i < gridSize; i += 1) {
          ivec3 cell = ivec3(i, j, k);
          ivec3 cellDist = abs(cell - pointCell);
          if (max(max(cellDist.x, cellDist.y), cellDist.z) <= 1) continue;
          velocity += cellVelocity(cell, gridSize, rowTiles, position);
        }
      }
    }
  } else {
    // The coarser level left its 3³ neighborhood unhandled; those cells refine to
    // the aligned 6³ child block at this level. Sample it minus this level's own
    // 3³ neighborhood (always strictly inside the block).
    ivec3 base = (pointCell / 2) * 2 - 2;
    for (int k = 0; k < 6; k += 1) {
      for (int j = 0; j < 6; j += 1) {
        for (int i = 0; i < 6; i += 1) {
          ivec3 cell = base + ivec3(i, j, k);
          // Bounds check must precede texelFetch (out-of-range fetches are undefined).
          if (any(lessThan(cell, ivec3(0))) || any(greaterThanEqual(cell, ivec3(gridSize)))) continue;
          ivec3 cellDist = abs(cell - pointCell);
          if (max(max(cellDist.x, cellDist.y), cellDist.z) <= 1) continue;
          velocity += cellVelocity(cell, gridSize, rowTiles, position);
        }
      }
    }
  }

  // z velocity lives in the blue channel (update-position.frag SPACE_3D contract) —
  // unlike the 2D force shaders, which write a constant 1.0 there.
  fragColor = vec4(velocity, 0.0);
}
