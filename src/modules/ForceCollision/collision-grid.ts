/**
 * Shared collision-cell and hash formulas for the slot peel and contact pass.
 * Cells are the contact range, counted from the world origin, which each
 * program binds as a uniform. The index is an unbounded integer, so a layout
 * anywhere in the world bins on the same cells and nothing about it is
 * measured before a pass.
 *
 * A quadratic rotation by the cell's block wraps the index onto a power-of-two
 * texture; the rotation changes each pass. Distant cells can share a texel and
 * its slot budget, but the contact shader verifies every candidate's world cell
 * before resolving a pair. Aliases cost sampling opportunities, never create
 * phantom contacts, and never count a pair twice.
 *
 * Both programs must bin identically. They receive the same anchor and the
 * same reciprocal cell size from the CPU, then use one subtraction and one
 * multiplication (correctly rounded in GLSL ES) and integer arithmetic from
 * there, so compiler reassociation cannot put the same point in different
 * cells. Far from the anchor the product's rounding bounds the index: at a
 * distance d it is d · 2⁻²⁴ / cell of a cell, below the position's own float32
 * resolution there, so a fixed anchor loses only contacts a position cannot
 * hold.
 */

/**
 * How many values the per-tick rotation seed cycles through: a whole number
 * below this, so the shaders read it from a float uniform exactly.
 */
export const COLLISION_SEED_PERIOD = 1024

/**
 * The block rotation r(k) = a·k² + b·k of each axis, as [a, b]: the x axis
 * takes its rotation from the cell's block along y, the y axis from the block
 * along x, so a layout straddling block boundaries along one axis only keeps
 * one rotation along it and binning there stays one to one. `a` sets the
 * second difference, 2·a·Δ² — twice how far the centroid of two cells Δ blocks
 * either side of a third, sharing its texel, lands from it; ±155 modulo 512
 * keeps that furthest from a multiple of the grid. `b` breaks the k ↔ -k
 * symmetry, and the two axes' pairs differ so the cells sharing a texel differ
 * per axis. Every tick adds collisionRotationSeed to each `b`, which changes
 * them from tick to tick and leaves both properties as they are.
 */
export const COLLISION_ROTATIONS: readonly [readonly [number, number], readonly [number, number]] = [
  [667, 902],
  [155, 118],
]

/**
 * What the given tick adds to every rotation's linear term: a step of 397
 * (odd, so all COLLISION_SEED_PERIOD values come round) from one tick to the
 * next.
 */
export const collisionRotationSeed = (tick: number): number => (tick * 397) & (COLLISION_SEED_PERIOD - 1)

/** Marker each collision shader carries where the shared code is spliced in. */
const COLLISION_GRID_MARKER = '// @collision-grid'

/**
 * Spliced in after the host's uniform block, so the host's uniform macros
 * (`#define cellsPerUnit forceCollisionSlots.cellsPerUnit`, …) are already in
 * effect and rewrite any matching identifier here as well — which is why every
 * name below differs from every host macro, and withCollisionGrid enforces it.
 * The host passes its anchor, cell-size and seed uniforms in as arguments.
 *
 * Every integer is declared highp: cell indices run to millions, the block
 * rotation's products need 32-bit wrapping arithmetic, and a fragment shader's
 * default int precision is mediump (16 bits guaranteed).
 */
const COLLISION_GRID_GLSL = /* glsl */`
// The cell holding a world position, counted from the anchor — the world
// origin, bound by the host as a uniform and passed in — unbounded:
// collisionTexel wraps it onto the grid. contactPerUnit is 1 / the cell size,
// the same bits in every program.
highp ivec2 collisionCell(vec2 worldPosition, vec2 anchor, float contactPerUnit) {
  // The only rounded steps: one subtraction, one multiplication, one floor.
  vec2 cell = floor((worldPosition - anchor) * contactPerUnit);
  // Bounded to whole numbers an int holds exactly, so an infinite position
  // lands on a cell instead of an undefined conversion.
  return ivec2(clamp(cell, vec2(-16777216.0), vec2(16777216.0)));
}

// How far one axis of a cell's texel is rotated: by r(k) = a·k² + b·k (mod the
// grid), k the cell's block along the OTHER axis, counted from the anchor's
// block (whose r is 0). Quadratic, so the centroid of two cells symmetric
// about a third never lands on it. uint arithmetic: it wraps modulo 2^32,
// which keeps the low bits — all the mask keeps — exact.
highp int collisionRotation(highp int block, highp uint square, highp uint linear, highp int texelMask) {
  highp uint k = uint(block);
  return int((square * k * k + linear * k) & uint(texelMask));
}

// The texel a cell hashes to this tick: the cell, rotated by its blocks,
// modulo the grid per axis — in [0, texelsPerAxis - 1] for any cell, negative
// ones included. Inside the anchor's block it is the cell itself. tickSeed is
// this tick's collisionRotationSeed, the same bits in every program.
highp ivec2 collisionTexel(highp ivec2 cell, float tickSeed, highp int texelsPerAxis) {
  highp int texelMask = texelsPerAxis - 1;
  highp ivec2 block = cell >> int(log2(float(texelsPerAxis)) + 0.5);
  highp uint tick = uint(tickSeed);
  highp ivec2 rotation = ivec2(
    collisionRotation(block.y, ${COLLISION_ROTATIONS[0][0]}u, ${COLLISION_ROTATIONS[0][1]}u + tick, texelMask),
    collisionRotation(block.x, ${COLLISION_ROTATIONS[1][0]}u, ${COLLISION_ROTATIONS[1][1]}u + tick, texelMask));
  return (cell + rotation) & texelMask;
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
