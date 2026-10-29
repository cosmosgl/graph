#version 300 es
precision highp float;
precision highp int;
// @min-auto-slots

// Finest-cell occupancy statistics for the near-field sample count. The
// finest level texture holds [sum(x), sum(y), count, …] per cell; this pass
// reduces its count channel over blocks of cells, one fragment per block, into
// [points, points in cells of more than MIN_AUTO_SLOTS, twice and four times it].
// A point in a cell fuller than the sample count is sampled rather than listed,
// and its force jitters from tick to tick; the CPU sums the blocks and picks the
// smallest count that leaves few enough points so (getWantedSlotCount). The
// thresholds are the automatic counts below the ceiling of 64: MIN_AUTO_SLOTS,
// defined from index.ts at the marker above, and its doublings. One pass over 512² cells into 16² blocks is
// 1024 fetches per fragment, well under a tenth of a millisecond.

uniform sampler2D levelTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform occupancyUniforms {
  float levelTextureWidth;
  float levelTextureHeight;
  float blockWidth;
  float blockHeight;
} occupancy;

#define levelTextureWidth occupancy.levelTextureWidth
#define levelTextureHeight occupancy.levelTextureHeight
#define blockWidth occupancy.blockWidth
#define blockHeight occupancy.blockHeight
#else
uniform float levelTextureWidth;
uniform float levelTextureHeight;
uniform float blockWidth;
uniform float blockHeight;
#endif

out vec4 fragColor;

void main() {
  ivec2 block = ivec2(gl_FragCoord.xy);
  ivec2 size = ivec2(levelTextureWidth, levelTextureHeight);
  ivec2 origin = block * ivec2(blockWidth, blockHeight);
  ivec2 end = min(origin + ivec2(blockWidth, blockHeight), size);

  vec4 points = vec4(0.0);
  for (int y = origin.y; y < end.y; y += 1) {
    for (int x = origin.x; x < end.x; x += 1) {
      float count = texelFetch(levelTexture, ivec2(x, y), 0).b;
      if (count <= 0.0) continue;
      // Counts are whole numbers: a step at n + 0.5 is "more than n"
      points += count * vec4(1.0, step(float(MIN_AUTO_SLOTS) + 0.5, count),
        step(float(MIN_AUTO_SLOTS * 2) + 0.5, count), step(float(MIN_AUTO_SLOTS * 4) + 0.5, count));
    }
  }

  fragColor = points;
}
