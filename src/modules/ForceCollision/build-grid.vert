#version 300 es
precision highp float;

uniform sampler2D positionsTexture;
uniform sampler2D sizeTexture;
uniform sampler2D exitTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform buildGridUniforms {
  vec2 gridOffset; // Lattice shift of this offset pass, in cells (0 or 0.5 per axis)
  float cellsPerUnit; // 1 / the hash's cell size (the contact range), from the CPU: the same bits as the force pass
  float rotationSeed; // This tick's addition to the hash's block rotations (collisionRotationSeed), the same as the force pass's
} buildGrid;

#define gridOffset buildGrid.gridOffset
#define cellsPerUnit buildGrid.cellsPerUnit
#define rotationSeed buildGrid.rotationSeed
#else
uniform vec2 gridOffset;
uniform float cellsPerUnit;
uniform float rotationSeed;
#endif

// @collision-grid

in vec2 pointIndices;

out vec4 cellData; // xy = position (relative to the data box's centre), z = size, w = count (1.0)

// A position the grid may take: finite. Read from the exponent bits, as the
// data bounds do (reduce-bounds-buckets.frag) — a compiler allowed to assume no
// NaNs may fold a comparison away.
bool isFinitePosition(vec2 position) {
  uvec2 exponent = floatBitsToUint(position) & 0x7f800000u;
  return all(notEqual(exponent, uvec2(0x7f800000u)));
}

void main() {
  ivec2 pointTexel = ivec2(pointIndices);

  // Absent points must not enter the grid — a NaN position bins to a NaN cell and
  // poisons the accumulated position/size sum for every point in that cell. (exit.g = absent)
  // Nor may a present point whose position is not finite: its sum would make
  // the centroid of every texel it lands on infinite or NaN.
  vec4 exitStatus = texelFetch(exitTexture, pointTexel, 0);
  vec4 pointPosition = texelFetch(positionsTexture, pointTexel, 0);
  if (exitStatus.g > 0.5 || !isFinitePosition(pointPosition.xy)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 pointSize = texelFetch(sizeTexture, pointTexel, 0);

  // Output: position sum, size sum, count — the position relative to the data
  // box's centre, as the force pass reads it (collision-grid.ts).
  cellData = vec4(collisionLocal(pointPosition.xy), pointSize.r, 1.0);

  // The texel this point's cell hashes to on this pass's grid — the same bits
  // force-collision-spatial.frag computes for it (collision-grid.ts).
  highp ivec2 texel = collisionTexel(collisionCell(pointPosition.xy, gridOffset, cellsPerUnit), gridOffset, rotationSeed);

  // Convert to clip space coordinates
  vec2 gridPosition = 2.0 * (vec2(texel) + 0.5) / collisionCellsPerAxis - 1.0;

  gl_Position = vec4(gridPosition, 0.0, 1.0);
  gl_PointSize = 1.0;
}
