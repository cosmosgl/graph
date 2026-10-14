#version 300 es
precision highp float;
// Fragment shaders default int to mediump; keep the loop counters highp like
// the other two passes'.
precision highp int;

// Middle pass of the data-bounds reduction (see data-bounds.ts): each fragment
// folds one blockSize × blockSize block of the first pass's partial boxes into
// one, so the final pass's single fragment reads a handful of texels instead of
// every partial box in sequence.

uniform sampler2D partialsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform reduceBoundsBlocksUniforms {
  float blockSize;
} reduceBoundsBlocks;

#define blockSize reduceBoundsBlocks.blockSize
#else
uniform float blockSize;
#endif

// The first pass's empty-bucket sentinel (must match reduce-bounds-buckets.frag).
const float BOUNDS_LIMIT = 1.0e30;

out vec4 bounds; // [minX, minY, maxX, maxY]

void main() {
  int size = int(blockSize);
  ivec2 first = ivec2(gl_FragCoord.xy) * size;

  // Empty partial boxes carry [+limit, +limit, -limit, -limit], neutral here.
  vec2 lo = vec2(BOUNDS_LIMIT);
  vec2 hi = vec2(-BOUNDS_LIMIT);
  for (int y = 0; y < size; y += 1) {
    for (int x = 0; x < size; x += 1) {
      vec4 partial = texelFetch(partialsTexture, first + ivec2(x, y), 0);
      lo = min(lo, partial.xy);
      hi = max(hi, partial.zw);
    }
  }

  bounds = vec4(lo, hi);
}
