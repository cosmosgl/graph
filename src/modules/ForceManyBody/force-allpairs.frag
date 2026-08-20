#version 300 es
precision highp float;
// Fragment shaders default int to mediump, guaranteed only to 32767 —
// point indices go far higher.
precision highp int;

// Exact all-pairs repulsion for small graphs. One fragment per point, looping
// over every other point — O(n²) total, but below the brute-force threshold a
// single pass is both cheaper than the grid pyramid's sequential depth-peeling
// passes and exact at any cell occupancy: no Monte-Carlo sampling, hence none
// of the per-tick re-sampling noise that shows up as shimmer in dense layouts
// (see force-nearfield.frag for the sampled path used above the threshold).

uniform sampler2D positionsTexture;
uniform sampler2D randomValues;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform forceAllPairsUniforms {
  float pointsTextureSize;
  float pointsNumber;
  float alpha;
  float repulsion;
  float maxStep;
} forceAllPairs;

#define pointsTextureSize forceAllPairs.pointsTextureSize
#define pointsNumber forceAllPairs.pointsNumber
#define alpha forceAllPairs.alpha
#define repulsion forceAllPairs.repulsion
#define maxStep forceAllPairs.maxStep
#else
uniform float pointsTextureSize;
uniform float pointsNumber;
uniform float alpha;
uniform float repulsion;
uniform float maxStep;
#endif

out vec4 fragColor;

// Same clamped inverse-distance falloff as the grid-path shaders (must stay identical).
vec2 pairwiseVelocity(vec2 position, vec2 otherPosition, vec2 randomDir) {
  vec2 distVector = position - otherPosition;
  float l = dot(distVector, distVector);
  if (l <= 0.0) {
    // Exactly coincident points have no separation direction, so an
    // inverse-distance force is undefined and they would stay stacked forever.
    // Kick along this point's random vector instead (each point has a
    // different one, so a pile disperses).
    distVector = randomDir;
    l = dot(distVector, distVector);
    if (l <= 0.0) return vec2(0.0);
  }
  float distanceMin2 = 1.0;
  if (l < distanceMin2) l = sqrt(distanceMin2 * l);
  float addV = alpha * repulsion / sqrt(l);
  return addV * normalize(distVector);
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

  // An absent point must neither move nor repel (its position is NaN).
  vec4 selfExit = texelFetch(exitTexture, pointTexel, 0);
  if (selfExit.g > 0.5) {
    fragColor = vec4(0.0);
    return;
  }

  vec2 position = texelFetch(positionsTexture, pointTexel, 0).rg;
  vec4 random = texelFetch(randomValues, pointTexel, 0);

  // Pairs are split at the grid path's near-field scale (maxStep = 2 × the
  // finest cell size it would use at this point count): closer pairs
  // correspond to its 3×3 near-field pass — jittered and bounded below, the
  // way that pass bounds its own sum — farther pairs to its level passes,
  // which it leaves unbounded. The same split keeps the dynamics continuous
  // across the point-count threshold between the two paths.
  vec2 nearVelocity = vec2(0.0);
  vec2 farVelocity = vec2(0.0);
  float nearRadius2 = maxStep * maxStep;
  for (int i = 0; i < count; i += 1) {
    if (i == selfIndex) continue;
    ivec2 texel = ivec2(i % size, i / size);
    if (texelFetch(exitTexture, texel, 0).g > 0.5) continue;
    vec2 otherPosition = texelFetch(positionsTexture, texel, 0).rg;
    vec2 distVector = position - otherPosition;
    vec2 pairVelocity = pairwiseVelocity(position, otherPosition, random.rg);
    if (dot(distVector, distVector) < nearRadius2) nearVelocity += pairVelocity;
    else farVelocity += pairVelocity;
  }

  // Random jitter proportional to the near velocity, to keep points from
  // sticking (same as the near-field pass).
  nearVelocity += nearVelocity * random.rg;

  // Bound the per-tick near kick. Exactness alone does not bound it: the
  // falloff still diverges at near-zero separations, and a coincident stack
  // sums n−1 same-direction random kicks into one fling. The clamp caps the
  // magnitude and keeps the direction.
  float speed = length(nearVelocity);
  if (speed > maxStep) nearVelocity *= maxStep / speed;

  fragColor = vec4(farVelocity + nearVelocity, 0.0, 0.0);
}
