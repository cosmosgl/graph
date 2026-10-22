/**
 * Shared collision-cell and hash formulas for the slot peel and contact pass.
 * Cells are the contact range, counted from the current GPU data bounds, so
 * collision follows layouts outside the initial space without widening cells.
 *
 * The integer cell is unbounded. A quadratic rotation by the cell's block
 * wraps it onto a power-of-two texture; the rotation changes each pass. Distant
 * cells can share a texel and its slot budget, but the contact shader verifies
 * every candidate's world cell before resolving a pair. Aliases cost sampling
 * opportunities, never create phantom contacts, and never count a pair twice.
 *
 * Both programs must bin identically. They receive the same reciprocal cell
 * size from the CPU, then use a subtraction and multiplication (correctly
 * rounded in GLSL ES). Half-cell offsets are applied after rounding, in integer
 * arithmetic, so compiler reassociation cannot put the same point in different
 * cells. The original four-lattice overload remains available for numerical
 * tests; the slot path uses the unshifted lattice and its point-count grid.
 */

/**
 * Default hash width for the standalone binning tests. The slot path passes
 * its point-count-dependent power-of-two width explicitly.
 */
export const COLLISION_GRID_SIZE = 1024

/**
 * The block rotation r(k) = a·k² + b·k of each offset lattice, as [a, b], in
 * GRID_OFFSETS order; the y axis takes the lattices in reverse. `a` sets the
 * second difference, 2·a·Δ² — twice how far the centroid of two cells Δ blocks
 * either side of a third, sharing its texel, lands from it. Of every `a`,
 * these four (±155 modulo 512) keep it furthest from a multiple of the grid:
 * 74 cells or more for every Δ up to 31, so that centroid lands 37 cells or
 * more away. `b` breaks the k ↔ -k symmetry and, with `a`, makes every pair of
 * blocks within 12 of each other rotate by a different amount on each lattice,
 * so the cells sharing a texel change from pass to pass. Every tick adds
 * collisionRotationSeed to each `b`, which changes them from tick to tick as
 * well and leaves both properties as they are: neither changes when every `b`
 * moves by the same amount.
 */
export const COLLISION_ROTATIONS: readonly (readonly [number, number])[] = [
  [667, 902],
  [869, 764],
  [357, 624],
  [155, 118],
]

/**
 * What the given tick adds to every rotation's linear term: a step of 397
 * (odd, so all COLLISION_GRID_SIZE values come round) from one tick to the
 * next. A whole number below COLLISION_GRID_SIZE, so the shaders read it from
 * a float uniform exactly.
 */
export const collisionRotationSeed = (tick: number): number => (tick * 397) & (COLLISION_GRID_SIZE - 1)

/** Marker each collision shader carries where the shared code is spliced in. */
const COLLISION_GRID_MARKER = '// @collision-grid'

/**
 * Spliced in after the host's uniform block, so the host's uniform macros
 * (`#define gridOffset buildGrid.gridOffset`, …) are already in effect and
 * rewrite any matching identifier here as well — which is why every name below
 * differs from every host macro, and withCollisionGrid enforces it. The host
 * passes its cell-size uniform in as an argument.
 *
 * Every integer is declared highp: cell indices run to millions, the block
 * rotation's products need 32-bit wrapping arithmetic, and a fragment shader's
 * default int precision is mediump (16 bits guaranteed).
 */
const COLLISION_GRID_GLSL = /* glsl */`
// This tick's data bounds, one texel: [originX, originY, extent, 1 / extent]
// (DataBounds); the hash counts its cells from the origin. Float data — highp,
// the default sampler precision is lowp.
uniform highp sampler2D dataBoundsTexture;

const float collisionCellsPerAxis = ${COLLISION_GRID_SIZE.toFixed(1)};

// The cell holding a world position, counted from the data origin on a lattice
// shifted by latticeShift cells (an offset pass: 0 or 0.5 per axis), unbounded:
// collisionTexel wraps it onto the grid. contactPerUnit is 1 / the cell size,
// the same bits in every program.
highp ivec2 collisionCell(vec2 worldPosition, vec2 latticeShift, float contactPerUnit) {
  vec2 dataOrigin = texelFetch(dataBoundsTexture, ivec2(0), 0).xy;
  // The half cell: the only rounded steps. Doubling the reciprocal is exact.
  vec2 halfCell = floor((worldPosition - dataOrigin) * (contactPerUnit * 2.0));
  // Bounded to whole numbers an int holds exactly, so an infinite position
  // lands on a cell instead of an undefined conversion.
  halfCell = clamp(halfCell, vec2(-16777216.0), vec2(16777216.0));
  // Two half cells per cell, a half-cell shift is one more: integers from here.
  highp ivec2 halfIndex = ivec2(halfCell) + ivec2(latticeShift * 2.0);
  return halfIndex >> 1;
}

// How far one axis of a cell's texel is rotated on one lattice: by
// r(k) = a·k² + b·k (mod the grid), k the cell's block along the OTHER axis,
// counted from the origin's block (whose r is 0). Taken from the other axis, a
// layout straddling block boundaries along one axis only keeps one rotation
// along it, and binning there stays one to one; quadratic, so the centroid of
// two cells symmetric about a third never lands on it. uint arithmetic: it
// wraps modulo 2^32, which keeps the low bits — all the mask keeps — exact.
highp int collisionRotation(highp int block, highp uint square, highp uint linear, highp int texelMask) {
  highp uint k = uint(block);
  return int((square * k * k + linear * k) & uint(texelMask));
}

// The texel a cell hashes to on one lattice's grid this tick: the cell, rotated
// by its blocks, modulo the grid per axis — in [0, collisionGridMask] for any
// cell, negative ones included. Inside the origin's block it is the cell
// itself. tickSeed is this tick's collisionRotationSeed, the same bits in
// every program.
highp ivec2 collisionTexel(highp ivec2 cell, vec2 latticeShift, float tickSeed, highp int texelsPerAxis) {
  highp int texelMask = texelsPerAxis - 1;
  highp ivec2 block = cell >> int(log2(float(texelsPerAxis)) + 0.5);
  highp int lattice = int(latticeShift.x * 2.0) + 2 * int(latticeShift.y * 2.0);
  // a and b per lattice (COLLISION_ROTATIONS), b moved on by this tick's seed
  highp uvec4 squares = uvec4(${COLLISION_ROTATIONS.map(([a]) => `${a}u`).join(', ')});
  highp uvec4 linears = uvec4(${COLLISION_ROTATIONS.map(([, b]) => `${b}u`).join(', ')}) + uvec4(uint(tickSeed));
  highp ivec2 rotation = ivec2(
    collisionRotation(block.y, squares[lattice], linears[lattice], texelMask),
    collisionRotation(block.x, squares[3 - lattice], linears[3 - lattice], texelMask));
  return (cell + rotation) & texelMask;
}

highp ivec2 collisionTexel(highp ivec2 cell, vec2 latticeShift, float tickSeed) {
  return collisionTexel(cell, latticeShift, tickSeed, ${COLLISION_GRID_SIZE});
}

// A world position relative to the centre of this tick's data box: what the
// grid accumulates and the force compares, so the sums — and the centroids and
// distances taken from them — keep the same float precision wherever the
// layout sits.
vec2 collisionLocal(vec2 worldPosition) {
  vec4 dataBounds = texelFetch(dataBoundsTexture, ivec2(0), 0);
  return worldPosition - (dataBounds.xy + 0.5 * dataBounds.z);
}
`

const COLLISION_GRID_IDENTIFIERS = new Set(COLLISION_GRID_GLSL.replace(/\/\/.*$/gm, '').match(/\b[A-Za-z_]\w*\b/g))

/**
 * Splices the shared collision-grid code into a collision shader at its marker.
 * Throws if the marker is missing, or if a host `#define` would rewrite an
 * identifier of the shared code — both otherwise surface as a shader compile
 * error far from the cause, or not at all.
 */
export function withCollisionGrid (source: string): string {
  if (!source.includes(COLLISION_GRID_MARKER)) {
    throw new Error(`Shader is missing the "${COLLISION_GRID_MARKER}" marker for the shared collision-grid code`)
  }
  for (const define of source.match(/^[ \t]*#define[ \t]+\w+/gm) ?? []) {
    const macro = define.replace(/^[ \t]*#define[ \t]+/, '')
    if (COLLISION_GRID_IDENTIFIERS.has(macro)) {
      throw new Error(`Shader macro "${macro}" collides with an identifier of the shared collision-grid code`)
    }
  }
  return source.replace(COLLISION_GRID_MARKER, COLLISION_GRID_GLSL)
}
