#version 300 es
precision highp float;
precision highp int;

// Finest-cell occupancy statistics for the near-field sample count. The
// finest level texture holds [sum(x), sum(y), count, …] per cell; this pass
// reduces its count channel over blocks of cells, one fragment per block, into
// [max count, Σ count, Σ count², occupied cells]. The CPU sums the blocks: the
// occupancy a typical point experiences is Σ count² / Σ count — the mean cell
// count weighted by how many points live in each cell, which is what sets the
// sampling noise the eye sees. One pass over 512² cells into 16² blocks is
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

  float maxCount = 0.0;
  float sum = 0.0;
  float sumSquares = 0.0;
  float occupied = 0.0;
  for (int y = origin.y; y < end.y; y += 1) {
    for (int x = origin.x; x < end.x; x += 1) {
      float count = texelFetch(levelTexture, ivec2(x, y), 0).b;
      if (count <= 0.0) continue;
      maxCount = max(maxCount, count);
      sum += count;
      sumSquares += count * count;
      occupied += 1.0;
    }
  }

  fragColor = vec4(maxCount, sum, sumSquares, occupied);
}
