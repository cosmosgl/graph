#version 300 es
precision highp float;
// Fragment shaders default int to mediump; keep the loop counters highp like
// the other two passes'.
precision highp int;

// Last pass of the data-bounds reduction (see data-bounds.ts): the middle
// pass's partial boxes folded into the one texel every consumer reads,
// [originX, originY, extent, 1 / extent] — a square of side `extent` whose
// lower-left corner is the origin.

uniform sampler2D partialsTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform reduceBoundsFinalUniforms {
  float partialGridSize;
  float minExtent;
} reduceBoundsFinal;

#define partialGridSize reduceBoundsFinal.partialGridSize
#define minExtent reduceBoundsFinal.minExtent
#else
uniform float partialGridSize;
uniform float minExtent;
#endif

// The first pass's empty-bucket sentinel (must match reduce-bounds-buckets.frag).
const float BOUNDS_LIMIT = 1.0e30;

out vec4 bounds; // [originX, originY, extent, 1 / extent]

void main() {
  int size = int(partialGridSize);

  // Empty partial boxes carry [+limit, +limit, -limit, -limit], neutral here.
  vec2 lo = vec2(BOUNDS_LIMIT);
  vec2 hi = vec2(-BOUNDS_LIMIT);
  for (int y = 0; y < size; y += 1) {
    for (int x = 0; x < size; x += 1) {
      vec4 partial = texelFetch(partialsTexture, ivec2(x, y), 0);
      lo = min(lo, partial.xy);
      hi = max(hi, partial.zw);
    }
  }

  // No usable point at all (every point absent or non-finite): collapse to a
  // degenerate box at the origin rather than turning the sentinels into an
  // extent; the floor below makes it a valid grid.
  if (hi.x < lo.x) {
    lo = vec2(0.0);
    hi = vec2(0.0);
  }

  // Square, because the consumers' grids are square and halve exactly level
  // to level; a non-square box would give non-square cells.
  vec2 centre = 0.5 * (lo + hi);
  float span = max(hi.x - lo.x, hi.y - lo.y);

  // Fitted to the points, with no margin: the outermost points sit on the
  // box's edge, where the consumers' edge clamp files them into the last cell
  // the same way on every level. A margin would only widen the cells over the
  // data and leave the layout's edge mid-cell on every level, which measurably
  // costs the far field accuracy at the edge.
  //
  // The floor is what makes a zero-size box (one point, or every point
  // stacked) usable: consumers divide the extent into cells and need a
  // non-zero cell size. The caller sets it from its own smallest meaningful
  // cell.
  float extent = max(span, minExtent);

  // The reciprocal is the one inexact step of the consumers' cell formula,
  // taken once here so every shader that bins a point reads the same bits
  // (grid-cell.ts).
  bounds = vec4(centre - 0.5 * extent, extent, 1.0 / extent);
}
