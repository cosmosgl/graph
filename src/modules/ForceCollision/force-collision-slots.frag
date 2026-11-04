#version 300 es
precision highp float;
// Fragment shaders default int to mediump, guaranteed only to 32767 —
// point indices go far higher.
precision highp int;

// Pairwise collision for large graphs, against depth-peeled per-cell slots.
// Used above ALL_PAIRS_MAX_POINTS (index.ts); below it the all-pairs pass tests
// every pair instead.
//
// The grid cell spans the contact range (≥ 2 × the largest radius), so every
// point this one can touch is in the 3×3 block around its cell. Each hash
// bucket's K slots hold a uniform random K-subset of its occupants, re-drawn
// every pass (build-nearfield-slots.vert). A bucket with K or fewer points is
// listed in full; denser buckets supply a fresh sample. Distant cells share
// this slot budget; the world-cell check below rejects aliased candidates.
// The cap below keeps each step bounded. No cell mean is ever used — a contact test
// against a mean cannot see a pair that overlaps while the mean sits out of
// range, which is how the previous grid path stalled in dense piles.
//
// The pairwise response is the all-pairs shader's and must stay identical to
// it: project the pair to contact along the line of centers, split by r² so
// the smaller disc yields, scale by `collisionStrength`, cap at one own radius
// per pass. Like it, this is a position correction and not a force: no alpha
// unless `collisionCooling` opts in, integrated with friction 1.

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;
uniform sampler2D exitTexture;
// One layer per peeling pass, [point index, hash] per cell. Float data —
// highp, the default sampler precision is lowp.
uniform highp sampler2DArray slotsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceCollisionSlotsUniforms {
  float pointsTextureSize;
  float gridSize;
  float slotCount;
  float collisionStrength;
  float collisionRadius;
  float collisionPadding;
  float alpha;
  float collisionCooling; // 0: full strength at every alpha; 1: scaled by alpha like the other forces
  float cellsPerUnit;
  float rotationSeed;
  vec2 collisionOrigin; // the world origin: where cells are counted from (collision-grid.ts)
} forceCollisionSlots;

#define pointsTextureSize forceCollisionSlots.pointsTextureSize
#define gridSize forceCollisionSlots.gridSize
#define slotCount forceCollisionSlots.slotCount
#define collisionStrength forceCollisionSlots.collisionStrength
#define collisionRadius forceCollisionSlots.collisionRadius
#define collisionPadding forceCollisionSlots.collisionPadding
#define alpha forceCollisionSlots.alpha
#define collisionCooling forceCollisionSlots.collisionCooling
#define cellsPerUnit forceCollisionSlots.cellsPerUnit
#define rotationSeed forceCollisionSlots.rotationSeed
#define collisionOrigin forceCollisionSlots.collisionOrigin
#else
uniform float pointsTextureSize;
uniform float gridSize;
uniform float slotCount;
uniform float collisionStrength;
uniform float collisionRadius;
uniform float collisionPadding;
uniform float alpha;
uniform float collisionCooling;
uniform float cellsPerUnit;
uniform float rotationSeed;
uniform vec2 collisionOrigin;
#endif

// @collision-grid

out vec4 fragColor;

// Effective collision radius: the fixed radius or half the size, plus padding.
// Must match the all-pairs path and the link force's rest-length floor.
float effectiveRadius(float size) {
  return (collisionRadius > 0.0 ? collisionRadius : size * 0.5) + collisionPadding;
}

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);
  int size = int(pointsTextureSize);
  int selfIndex = pointTexel.y * size + pointTexel.x;

  // An absent point neither moves nor blocks (its position is NaN).
  if (texelFetch(exitTexture, pointTexel, 0).g > 0.5) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 position = texelFetch(positionsTexture, pointTexel, 0).rg;
  float selfRadius = effectiveRadius(texelFetch(sizeTexture, pointTexel, 0).r);
  float selfRadius2 = selfRadius * selfRadius;

  // Must match the cell formula of the peel pass exactly.
  int cells = int(gridSize);
  highp ivec2 pointCell = collisionCell(position, collisionOrigin, cellsPerUnit);

  vec2 correction = vec2(0.0);
  int slots = int(slotCount);

  for (int j = -1; j <= 1; j += 1) {
    for (int i = -1; i <= 1; i += 1) {
      highp ivec2 cell = pointCell + ivec2(i, j);
      ivec2 slotCell = collisionTexel(cell, rotationSeed, cells);

      // An exhausted cell peels empty slots (index -1) for the remaining
      // layers; empty layers can't be followed by occupied ones within a cell.
      for (int s = 0; s < slots; s += 1) {
        float slotIndex = texelFetch(slotsTexture, ivec3(slotCell, s), 0).r;
        if (slotIndex < 0.0) break;
        // Exact `==` on a float-stored index holds for whole numbers below 2^24
        // — every realistic graph (a points texture bigger than 4096²).
        int other = int(slotIndex);
        if (other == selfIndex) continue;

        ivec2 otherTexel = ivec2(other % size, other / size);
        vec2 otherPosition = texelFetch(positionsTexture, otherTexel, 0).rg;
        // Hash aliases share the slot budget, but never create a phantom contact
        // or count one neighbour twice when two scanned cells share a texel.
        if (any(notEqual(collisionCell(otherPosition, collisionOrigin, cellsPerUnit), cell))) continue;
        vec2 distVector = position - otherPosition;
        float dist2 = dot(distVector, distVector);

        float otherRadius = effectiveRadius(texelFetch(sizeTexture, otherTexel, 0).r);
        float contact = selfRadius + otherRadius;
        if (dist2 >= contact * contact) continue;

        float dist = sqrt(dist2);
        vec2 direction;
        if (dist > 1e-4) {
          direction = distVector / dist;
        } else {
          // Coincident points have no separation direction. Push along a
          // per-point golden-angle direction: consecutive indices fan out in
          // well-separated directions, so a stack disperses deterministically.
          float angle = float(selfIndex) * 2.399963229728653;
          direction = vec2(cos(angle), sin(angle));
          dist = 0.0;
        }

        // Project the pair to contact; the bigger disc yields less (d3's r² split).
        float otherRadius2 = otherRadius * otherRadius;
        float overlap = contact - dist;
        correction += direction * (overlap * otherRadius2 / (selfRadius2 + otherRadius2));
      }
    }
  }

  // Optional cooling: alpha^cooling, 1 at cooling 0 (the branch avoids pow(0, 0)).
  float cooling = collisionCooling > 0.0 ? pow(max(alpha, 0.0), collisionCooling) : 1.0;
  correction *= collisionStrength * cooling;

  // Cap the per-pass correction at one own radius. A point deep in a pile sums
  // many overlapping pairs into one large vector; the cap keeps the direction
  // (away from where the pile is densest) and bounds the step, so the pile
  // inflates over a few passes instead of exploding and ping-ponging back.
  float maxStep = selfRadius;
  float speed = length(correction);
  if (speed > maxStep) correction *= maxStep / speed;

  fragColor = vec4(correction, 0.0, 0.0);
}
