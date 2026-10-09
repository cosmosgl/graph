#version 300 es
precision highp float;
// Fragment shaders default int to mediump, guaranteed only to 32767 —
// point indices go far higher.
precision highp int;

// Exact pairwise collision for small graphs: one fragment per point, looping
// over every other point. Used at or below ALL_PAIRS_MAX_POINTS (index.ts);
// above it, force-collision-slots.frag tests real per-cell neighbours instead.
//
// Both replaced a grid that reacted to each cell's *average* occupant. In a
// dense pile that stalled: a point got no push unless it overlapped an
// average, so two points could sit inside each other while every cell mean was
// out of range, and near-coincident points saw the same field and never parted.
// Here every overlapping pair is resolved directly, d3-force style: the pair
// is projected to contact along the line between the centers, and the
// correction is split by r² so the smaller disc yields to the bigger one.
//
// The output is a position correction, not a force: it is not scaled by
// alpha (collision is a constraint that must hold while the layout cools),
// the integrator applies it with friction 1, and its magnitude is capped at
// one own radius per pass so a deep pile unwinds over a few passes instead of
// flinging apart. `collisionStrength` is the relaxation factor (1 = full
// projection per pass).

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceCollisionAllPairsUniforms {
  float pointsTextureSize;
  float pointsNumber;
  float collisionStrength;
  float collisionRadius;
  float collisionPadding;
  float maxRadius; // the largest effective radius in the graph: the pair-reject bound
} forceCollisionAllPairs;

#define pointsTextureSize forceCollisionAllPairs.pointsTextureSize
#define pointsNumber forceCollisionAllPairs.pointsNumber
#define collisionStrength forceCollisionAllPairs.collisionStrength
#define collisionRadius forceCollisionAllPairs.collisionRadius
#define collisionPadding forceCollisionAllPairs.collisionPadding
#define maxRadius forceCollisionAllPairs.maxRadius
#else
uniform float pointsTextureSize;
uniform float pointsNumber;
uniform float collisionStrength;
uniform float collisionRadius;
uniform float collisionPadding;
uniform float maxRadius;
#endif

out vec4 fragColor;

// Effective collision radius: the fixed radius or half the size, plus padding.
// Must match the grid path and the link force's rest-length floor.
float effectiveRadius(float size) {
  return (collisionRadius > 0.0 ? collisionRadius : size * 0.5) + collisionPadding;
}

void main() {
  ivec2 pointTexel = ivec2(gl_FragCoord.xy);
  int size = int(pointsTextureSize);
  int selfIndex = pointTexel.y * size + pointTexel.x;
  int count = int(pointsNumber);

  // Fragments beyond the point count are unused texture pixels.
  if (selfIndex >= count) {
    fragColor = vec4(0.0);
    return;
  }

  // An absent point neither moves nor blocks (its position is NaN).
  if (texelFetch(exitTexture, pointTexel, 0).g > 0.5) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 position = texelFetch(positionsTexture, pointTexel, 0).rg;
  float selfRadius = effectiveRadius(texelFetch(sizeTexture, pointTexel, 0).r);
  float selfRadius2 = selfRadius * selfRadius;

  // No pair can touch beyond selfRadius + maxRadius: reject on the position
  // alone before paying for the size and exit fetches.
  float rejectDistance = selfRadius + maxRadius;
  float rejectDistance2 = rejectDistance * rejectDistance;

  vec2 correction = vec2(0.0);
  for (int i = 0; i < count; i += 1) {
    if (i == selfIndex) continue;
    ivec2 texel = ivec2(i % size, i / size);
    vec2 otherPosition = texelFetch(positionsTexture, texel, 0).rg;
    vec2 distVector = position - otherPosition;
    float dist2 = dot(distVector, distVector);
    // Written as `!(dist2 < bound)` so a NaN position is rejected too — a NaN
    // fails every comparison, and `>=` would let it through.
    if (!(dist2 < rejectDistance2)) continue;
    // Absent points are skipped through exit.G, never by their position: a point
    // removed with an animated setPointPositions keeps its last finite position
    // on the GPU after the fade. Same test as the slot peel and the many-body pass.
    if (texelFetch(exitTexture, texel, 0).g > 0.5) continue;

    float otherRadius = effectiveRadius(texelFetch(sizeTexture, texel, 0).r);
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

  correction *= collisionStrength;

  // Cap the per-pass correction at one own radius. A point deep in a pile sums
  // many overlapping pairs into one large vector; the cap keeps the direction
  // (away from where the pile is densest) and bounds the step, so the pile
  // inflates over a few passes instead of exploding and ping-ponging back.
  float maxStep = selfRadius;
  float speed = length(correction);
  if (speed > maxStep) correction *= maxStep / speed;

  fragColor = vec4(correction, 0.0, 0.0);
}
