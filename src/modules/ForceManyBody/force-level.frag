#version 300 es
precision highp float;

// One grid level of precise many-body repulsion (Barnes-Hut-style approximation).
//
// Levels are 2D grids of increasing resolution (4², 8², …) holding
// [sum(x), sum(y), count, 0] per cell. The decomposition tiles space exactly
// once across the level passes: after level L the only un-accumulated region is
// the 3×3 Chebyshev-1 neighborhood of the point's cell, which the next level
// refines (its aligned 6×6 child block), and which force-nearfield.frag finally
// covers at the finest level. The exclusion shell is fixed at Chebyshev
// distance 1.

uniform sampler2D positionsTexture;
uniform sampler2D levelTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceLevelPreciseUniforms {
  float levelGridSize;
  float cellSize;
  float isFirstLevel;
  float alpha;
  float repulsion;
} forceLevelPrecise;

#define levelGridSize forceLevelPrecise.levelGridSize
#define cellSize forceLevelPrecise.cellSize
#define isFirstLevel forceLevelPrecise.isFirstLevel
#define alpha forceLevelPrecise.alpha
#define repulsion forceLevelPrecise.repulsion
#else
uniform float levelGridSize;
uniform float cellSize;
uniform float isFirstLevel;
uniform float alpha;
uniform float repulsion;
#endif

in vec2 textureCoords;
out vec4 fragColor;

// Repulsion from one cell's center of mass — a d3-style clamped
// inverse-distance falloff.
vec2 cellVelocity(ivec2 cell, vec2 position) {
  vec4 centermass = texelFetch(levelTexture, cell, 0);
  // Count-only guard: zero coordinate sums are legitimate, but dividing by a zero
  // count would produce NaN that additive blending propagates into the velocity FBO.
  if (centermass.b <= 0.0) return vec2(0.0);
  vec2 centermassPosition = centermass.rg / centermass.b;
  vec2 distVector = position - centermassPosition;
  float l = dot(distVector, distVector);
  if (l <= 0.0) return vec2(0.0);
  float distanceMin2 = 1.0;
  if (l < distanceMin2) l = sqrt(distanceMin2 * l);
  float addV = alpha * repulsion * centermass.b / sqrt(l);
  return addV * normalize(distVector);
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec2 position = pointPosition.rg;

  int gridSize = int(levelGridSize);
  // Must match the aggregation shader's cell formula exactly.
  ivec2 pointCell = clamp(ivec2(floor(position / cellSize)), ivec2(0), ivec2(gridSize - 1));

  vec2 velocity = vec2(0.0);

  if (isFirstLevel > 0.5) {
    // Coarsest level: every cell except the 3×3 neighborhood, which finer levels refine.
    for (int j = 0; j < gridSize; j += 1) {
      for (int i = 0; i < gridSize; i += 1) {
        ivec2 cell = ivec2(i, j);
        ivec2 cellDist = abs(cell - pointCell);
        if (max(cellDist.x, cellDist.y) <= 1) continue;
        velocity += cellVelocity(cell, position);
      }
    }
  } else {
    // The coarser level left its 3×3 neighborhood unhandled; those cells refine to
    // the aligned 6×6 child block at this level. Sample it minus this level's own
    // 3×3 neighborhood (always strictly inside the block).
    ivec2 base = (pointCell / 2) * 2 - 2;
    for (int j = 0; j < 6; j += 1) {
      for (int i = 0; i < 6; i += 1) {
        ivec2 cell = base + ivec2(i, j);
        // Bounds check must precede texelFetch (out-of-range fetches are undefined).
        if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(gridSize)))) continue;
        ivec2 cellDist = abs(cell - pointCell);
        if (max(cellDist.x, cellDist.y) <= 1) continue;
        velocity += cellVelocity(cell, position);
      }
    }
  }

  fragColor = vec4(velocity, 0.0, 0.0);
}
