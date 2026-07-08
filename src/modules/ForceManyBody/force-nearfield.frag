#version 300 es
precision highp float;

// Near-field pass of the precise grid repulsion (P3M-style). After the finest
// level pass, the only un-accumulated region is the 3×3 neighborhood of the
// point's cell.
//
// Cell centroids exert a purely radial force there, which flattens dense hubs
// into disks and petals — even as a residual for unsampled mass, the centroid
// bias dominates (tangential repulsion scaled by ~K/n never spreads a dense
// clump before alpha decays). So the near field is a pure Monte-Carlo estimator
// instead: the K depth-peeled points of a cell are a uniform random subset
// (re-drawn every tick by build-nearfield-slots.vert), and weighting each
// sampled pairwise force by count/sampled makes the expected force equal the
// exact all-pairs sum — unbiased, no centroid term. Cells holding ≤ K points
// are sampled exhaustively, so their forces are exact. The per-tick sampling
// noise acts as annealed jitter: it shrinks with alpha and is precisely what
// breaks clumps apart. The point itself is excluded from both the sample and
// the count.

uniform sampler2D positionsTexture;
uniform sampler2D levelTexture;
uniform sampler2D randomValues;
uniform sampler2D slotTexture0;
uniform sampler2D slotTexture1;
uniform sampler2D slotTexture2;
uniform sampler2D slotTexture3;
uniform sampler2D slotTexture4;
uniform sampler2D slotTexture5;
uniform sampler2D slotTexture6;
uniform sampler2D slotTexture7;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceNearFieldUniforms {
  float pointsTextureSize;
  float levelGridSize;
  float cellSize;
  float alpha;
  float repulsion;
} forceNearField;

#define pointsTextureSize forceNearField.pointsTextureSize
#define levelGridSize forceNearField.levelGridSize
#define cellSize forceNearField.cellSize
#define alpha forceNearField.alpha
#define repulsion forceNearField.repulsion
#else
uniform float pointsTextureSize;
uniform float levelGridSize;
uniform float cellSize;
uniform float alpha;
uniform float repulsion;
#endif

in vec2 textureCoords;
out vec4 fragColor;

// Same clamped inverse-distance falloff as the level passes (must stay identical).
vec2 pairwiseVelocity(vec2 position, vec2 otherPosition, vec2 randomDir) {
  vec2 distVector = position - otherPosition;
  float l = dot(distVector, distVector);
  if (l <= 0.0) {
    // Exactly coincident points have no separation direction, so an inverse-distance
    // force is undefined and they would stay stacked forever — a stack's cell count
    // then repels everything around it, carving a void ring. Kick along this point's
    // random vector instead (each point has a different one, so a pile disperses),
    // mirroring the brute-force pass's coincident handling.
    distVector = randomDir;
    l = dot(distVector, distVector);
    if (l <= 0.0) return vec2(0.0);
  }
  float distanceMin2 = 1.0;
  if (l < distanceMin2) l = sqrt(distanceMin2 * l);
  float addV = alpha * repulsion / sqrt(l);
  return addV * normalize(distVector);
}

// One peeled slot of a cell: the unweighted pairwise force from the sampled
// point, counting it toward the sample size. Empty slots and the point itself
// contribute nothing.
vec2 slotVelocity(vec2 slot, vec2 position, float selfIndex, vec2 randomDir, inout float sampled) {
  float index = slot.x;
  if (index < 0.0 || index == selfIndex) return vec2(0.0);
  int size = int(pointsTextureSize);
  int i = int(index);
  vec4 other = texelFetch(positionsTexture, ivec2(i % size, i / size), 0);
  sampled += 1.0;
  return pairwiseVelocity(position, other.rg, randomDir);
}

void main() {
  vec4 pointPosition = texture(positionsTexture, textureCoords);
  vec2 position = pointPosition.rg;
  // One fragment per point: the fragment's pixel is the point's texel.
  float selfIndex = floor(gl_FragCoord.y) * pointsTextureSize + floor(gl_FragCoord.x);
  vec4 random = texture(randomValues, textureCoords);

  int gridSize = int(levelGridSize);
  ivec2 pointCell = clamp(ivec2(floor(position / cellSize)), ivec2(0), ivec2(gridSize - 1));

  vec2 velocity = vec2(0.0);

  for (int j = -1; j <= 1; j += 1) {
    for (int i = -1; i <= 1; i += 1) {
      ivec2 cell = pointCell + ivec2(i, j);
      if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(gridSize)))) continue;

      // [sum(x), sum(y), count, 0] — only the count is used here.
      vec4 aggregate = texelFetch(levelTexture, cell, 0);
      // The count never includes the point itself in the estimate.
      bool ownCell = (i == 0 && j == 0);
      float others = aggregate.b - (ownCell ? 1.0 : 0.0);
      if (others <= 0.0) continue;

      vec2 pairSum = vec2(0.0);
      float sampled = 0.0;
      // Sampler arrays cannot be indexed dynamically in GLSL ES 3.0 — unrolled.
      pairSum += slotVelocity(texelFetch(slotTexture0, cell, 0).rg, position, selfIndex, random.rg, sampled);
      pairSum += slotVelocity(texelFetch(slotTexture1, cell, 0).rg, position, selfIndex, random.rg, sampled);
      pairSum += slotVelocity(texelFetch(slotTexture2, cell, 0).rg, position, selfIndex, random.rg, sampled);
      pairSum += slotVelocity(texelFetch(slotTexture3, cell, 0).rg, position, selfIndex, random.rg, sampled);
      pairSum += slotVelocity(texelFetch(slotTexture4, cell, 0).rg, position, selfIndex, random.rg, sampled);
      pairSum += slotVelocity(texelFetch(slotTexture5, cell, 0).rg, position, selfIndex, random.rg, sampled);
      pairSum += slotVelocity(texelFetch(slotTexture6, cell, 0).rg, position, selfIndex, random.rg, sampled);
      pairSum += slotVelocity(texelFetch(slotTexture7, cell, 0).rg, position, selfIndex, random.rg, sampled);

      // Horvitz–Thompson weighting: the sample is uniform among the cell's
      // other points (conditioned on whether the point itself was peeled),
      // so scaling by others/sampled gives E[force] = exact all-pairs sum.
      // Exhaustively peeled cells (others == sampled) are exact.
      if (sampled > 0.0) velocity += (others / sampled) * pairSum;
    }
  }

  // Random jitter proportional to the velocity, to keep points from sticking.
  velocity += velocity * random.rg;

  // Bound the per-tick kick to the neighborhood scale. The estimator is unbiased
  // but high-variance: in a cell holding far more points than sampled slots, the
  // count/sampled weight can turn a few close samples into a huge one-tick kick.
  // Unbounded, that flings points across the screen at startup and — because the
  // weight is largest where density is highest — ejects points from dense cluster
  // centers, leaving voids. Clamping the magnitude keeps the spreading direction
  // while capping the fling; genuine spreading kicks are far below this bound and
  // pass through untouched. The far-field grid levels still drive bulk expansion.
  float maxStep = 2.0 * cellSize;
  float speed = length(velocity);
  if (speed > maxStep) velocity *= maxStep / speed;

  fragColor = vec4(velocity, 0.0, 0.0);
}
