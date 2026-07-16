#version 300 es
precision highp float;

// One depth-peeling pass of the near-field point-slot build.
//
// The precise grid's near field needs actual point-to-point forces (cell
// centroids alone exert a purely radial force that flattens dense hubs into
// disks and spikes). Each peeling pass selects, per finest-level cell, the
// not-yet-peeled point with the smallest per-tick random hash: the depth test
// keeps the smallest `hashValue` among eligible points, and eligibility excludes
// points already captured by the previous slot (hash <= previous slot's hash).
// Running K passes yields a uniform random K-subset per cell, re-randomized
// every tick via `randomSeed`; force-nearfield.frag turns it into an unbiased
// estimate of the cell's exact all-pairs repulsion (Monte-Carlo P3M).

uniform sampler2D positionsTexture;
uniform sampler2D previousSlot;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform buildNearFieldSlotsUniforms {
  float pointsTextureSize;
  float levelGridSize;
  float cellSize;
  float hasPreviousSlot;
  float randomSeed;
} buildNearFieldSlots;

#define pointsTextureSize buildNearFieldSlots.pointsTextureSize
#define levelGridSize buildNearFieldSlots.levelGridSize
#define cellSize buildNearFieldSlots.cellSize
#define hasPreviousSlot buildNearFieldSlots.hasPreviousSlot
#define randomSeed buildNearFieldSlots.randomSeed
#else
uniform float pointsTextureSize;
uniform float levelGridSize;
uniform float cellSize;
uniform float hasPreviousSlot;
uniform float randomSeed;
#endif

in vec2 pointIndices;

out vec2 slotData; // [point index, hash]

void main() {
  // Absent points must not be captured as neighbors — a NaN position bins to an
  // undefined cell and its distance poisons the force of every point sampling
  // that slot. Same guard as calculate-level.vert. (exit.G = absent)
  vec4 exitStatus = texture(exitTexture, (pointIndices + 0.5) / pointsTextureSize);
  if (exitStatus.g > 0.5) {
    slotData = vec2(-1.0, 1.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }

  vec4 pointPosition = texture(positionsTexture, (pointIndices + 0.5) / pointsTextureSize);
  float index = pointIndices.y * pointsTextureSize + pointIndices.x;

  // Per-tick random ordering via an integer hash (lowbias32). A fract(sin(...))
  // hash breaks down here: at large point indices GPU sin() loses precision
  // (differently per vendor), producing correlated or colliding hashes — and a
  // hash collision makes the peeling test below silently drop a point from the
  // sample. Integer ops are exact everywhere, and both inputs are exact (the
  // index is an integer-valued float; floatBitsToUint reinterprets seed bits).
  uint h = uint(index) ^ floatBitsToUint(randomSeed);
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  // Top 24 bits only, so the value is exactly representable in a float32 and
  // round-trips bit-exactly through the slot texture into the next pass's
  // comparison. Kept strictly inside (0, 1) so the depth range is safe.
  float hashValue = (float(h >> 8u) + 0.5) / 16777216.0;
  hashValue = 0.001 + hashValue * 0.998;

  // Must match the cell formula of the aggregation and force shaders exactly.
  int gridSize = int(levelGridSize);
  ivec2 cell = clamp(ivec2(floor(pointPosition.rg / cellSize)), ivec2(0), ivec2(gridSize - 1));

  if (hasPreviousSlot > 0.5) {
    vec2 previous = texelFetch(previousSlot, cell, 0).rg;
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
  vec2 ndc = 2.0 * (vec2(cell) + 0.5) / levelGridSize - 1.0;
  // The depth test (less) keeps the eligible point with the smallest hash.
  gl_Position = vec4(ndc, hashValue * 2.0 - 1.0, 1.0);
  gl_PointSize = 1.0;
}
