#version 300 es
precision highp float;

// One grid level of precise many-body repulsion (Barnes-Hut-style approximation).
//
// Levels are 2D grids of increasing resolution (8², 16², …) holding
// [sum(x), sum(y), count, 0] per cell. The decomposition tiles space exactly
// once across the level passes: after level L the only un-accumulated region is
// a shell of Chebyshev radius r around the point's cell — 5×5 on every level
// but the finest, 3×3 there (getShellRadius in index.ts) — which the next level
// refines as its aligned (4r+2)² child block, and which force-nearfield.frag
// finally covers at the finest level. Every level divides this tick's data
// bounds (grid-cell.ts), not the space, shifted by a fresh random offset every
// tick so the boundaries where that split changes never stay on one line
// (ForceManyBody's class doc).

uniform sampler2D positionsTexture;
uniform sampler2D levelTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceLevelPreciseUniforms {
  float levelGridSize;
  float isFirstLevel;
  float alpha;
  float repulsion;
  float shellRadius;
  float parentShellRadius;
} forceLevelPrecise;

#define levelGridSize forceLevelPrecise.levelGridSize
#define isFirstLevel forceLevelPrecise.isFirstLevel
#define alpha forceLevelPrecise.alpha
#define repulsion forceLevelPrecise.repulsion
#define shellRadius forceLevelPrecise.shellRadius
#define parentShellRadius forceLevelPrecise.parentShellRadius
#else
uniform float levelGridSize;
uniform float isFirstLevel;
uniform float alpha;
uniform float repulsion;
// Chebyshev radius of the shell this level leaves to the next (2 = 5×5,
// 1 = 3×3), and the radius the coarser level left, which sizes the child block
// refined here (0 on the coarsest level, which has no parent).
uniform float shellRadius;
uniform float parentShellRadius;
#endif

// @grid-cell

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
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);

  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  vec2 position = pointPosition.rg;

  int gridSize = int(levelGridSize);
  // The aggregation shader's cell formula (grid-cell.ts), shared exactly.
  ivec2 pointCell = gridCell(position, levelGridSize);

  vec2 velocity = vec2(0.0);

  // The shell is the cells left to the next level. A centroid is only ever used
  // from outside it, so from at least shellRadius cells away.
  int shell = int(shellRadius);
  if (isFirstLevel > 0.5) {
    // Coarsest level: every cell except the shell, which finer levels refine.
    for (int j = 0; j < gridSize; j += 1) {
      for (int i = 0; i < gridSize; i += 1) {
        ivec2 cell = ivec2(i, j);
        ivec2 cellDist = abs(cell - pointCell);
        if (max(cellDist.x, cellDist.y) <= shell) continue;
        velocity += cellVelocity(cell, position);
      }
    }
  } else {
    // The coarser level left its (2r+1)² shell unhandled; those cells refine to
    // the aligned (4r+2)² child block at this level. Sample it minus this
    // level's own shell (always strictly inside the block).
    int parentShell = int(parentShellRadius);
    int blockSize = 2 * (2 * parentShell + 1);
    ivec2 base = (pointCell / 2) * 2 - 2 * parentShell;
    for (int j = 0; j < blockSize; j += 1) {
      for (int i = 0; i < blockSize; i += 1) {
        ivec2 cell = base + ivec2(i, j);
        // Bounds check must precede texelFetch (out-of-range fetches are undefined).
        if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(gridSize)))) continue;
        ivec2 cellDist = abs(cell - pointCell);
        if (max(cellDist.x, cellDist.y) <= shell) continue;
        velocity += cellVelocity(cell, position);
      }
    }
  }

  fragColor = vec4(velocity, 0.0, 0.0);
}
