#version 300 es
precision highp float;
// Fragment shaders default int to mediump, guaranteed only to 32767 — the
// point index below runs up to the point count.
precision highp int;

// First pass of the data-bounds reduction (see data-bounds.ts): every live
// point folded into a small grid of partial boxes, one per fragment. Each
// fragment strides through the point list (bucket b takes points b, b + B²,
// b + 2·B², …), so the work splits evenly however the points are laid out in
// the texture or in space.

uniform sampler2D positionsTexture;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform reduceBoundsBucketsUniforms {
  float pointsTextureSize;
  float pointsNumber;
  float bucketGridSize;
} reduceBoundsBuckets;

#define pointsTextureSize reduceBoundsBuckets.pointsTextureSize
#define pointsNumber reduceBoundsBuckets.pointsNumber
#define bucketGridSize reduceBoundsBuckets.bucketGridSize
#else
uniform float pointsTextureSize;
uniform float pointsNumber;
uniform float bucketGridSize;
#endif

// Larger than any coordinate a layout can usefully reach (float32 resolves
// nothing near the force kernel's 1-unit scale past ~1e7), small enough that
// the last pass's sums and differences of two such values stay finite.
const float BOUNDS_LIMIT = 1.0e30;

out vec4 bounds; // [minX, minY, maxX, maxY]

// A coordinate the box may include: finite and within BOUNDS_LIMIT. The
// infinity/NaN test reads the exponent bits rather than comparing: a compiler
// allowed to assume no NaNs may fold a comparison-based test away, and a
// single NaN taken into the box would make every cell index of the whole grid
// undefined.
bool isUsable(vec2 position) {
  uvec2 exponent = floatBitsToUint(position) & 0x7f800000u;
  if (any(equal(exponent, uvec2(0x7f800000u)))) return false;
  return all(lessThanEqual(abs(position), vec2(BOUNDS_LIMIT)));
}

void main() {
  int size = int(pointsTextureSize);
  int buckets = int(bucketGridSize);
  int count = int(pointsNumber);

  ivec2 bucket = ivec2(gl_FragCoord.xy);
  int stride = buckets * buckets;

  // An empty bucket stays neutral under the second pass's min/max.
  vec2 lo = vec2(BOUNDS_LIMIT);
  vec2 hi = vec2(-BOUNDS_LIMIT);

  for (int i = bucket.y * buckets + bucket.x; i < count; i += stride) {
    ivec2 texel = ivec2(i % size, i / size);

    // Absent points hold no live coordinate (NaN, or a stale last position).
    // Same guard as calculate-level.vert. (exit.G = absent)
    if (texelFetch(exitTexture, texel, 0).g > 0.5) continue;

    vec2 position = texelFetch(positionsTexture, texel, 0).rg;
    if (!isUsable(position)) continue;

    lo = min(lo, position);
    hi = max(hi, position);
  }

  bounds = vec4(lo, hi);
}
