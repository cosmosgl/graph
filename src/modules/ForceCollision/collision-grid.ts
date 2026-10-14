/**
 * The one definition of "which texel of the collision hash holds this
 * position", injected into both collision shaders: build-grid.vert (binning
 * every point into an offset pass's grid) and force-collision-spatial.frag
 * (finding a point's own cell, and from it the 3×3 block it scans).
 *
 * The two must agree cell for cell. The force shader takes a point's own
 * contribution out of the cell it computes for that point before averaging the
 * rest — a point binned into one cell and looked up in its neighbour would have
 * itself subtracted from a cell it is not in, and the neighbour's centroid and
 * count go wrong with it.
 *
 * The cell is always the contact range, however large the layout. The force
 * compares a point with the centroid of each neighbouring cell, which only
 * stands in for that cell's points while the cell is no wider than the range
 * they collide over. A cell widened to fit a fixed texel count over the layout
 * breaks that: measured, 500 overlapping clusters with one point 7,000 units
 * away (a 13.7-unit cell where the contact range is 8) ended with more deep
 * overlaps than they started with — worse than no collision at all.
 *
 * So the grid is a spatial hash. Cells are counted from this tick's data
 * origin (DataBounds; ForceCollision floors the box at the grid's width, so
 * the origin follows the layout's centre) without bound, and fall into blocks
 * of COLLISION_GRID_SIZE cells per axis, counted from the origin's block. A
 * cell's texel is the cell modulo the grid after each axis is rotated by an
 * amount set by the cell's block along the other axis, and by the offset
 * lattice: r(k) = a·k² + b·k (COLLISION_ROTATIONS), so the origin's block is
 * not rotated at all. Negative cells are no exception: the size is a power of
 * two, so the modulo is a mask and the block a shift. The 3×3 scan hashes
 * each neighbour the same way.
 *
 * - A layout no wider than 1,022 contact ranges — 8,176 units at the smallest
 *   (8-unit) cell — whose cells, scans included, cross block boundaries along
 *   one axis at most keeps a single rotation along that axis: no texel holds
 *   two cells it occupies, or one of them and a cell its points scan, and it
 *   bins exactly as on a plain grid. The floor centres any layout up to 1,020
 *   ranges wide in the origin's block, scans included. Only a box stretched by
 *   far-flung points can put a narrow part of a layout across a block corner,
 *   where cells of the two diagonal blocks may share texels.
 * - Wider, cells of different blocks share texels: cells a grid's width or
 *   more apart along an axis, or — bar a rare coincidence of rotations —
 *   hundreds of ranges apart diagonally. A shared texel's centroid is out of
 *   reach of the points of each cell, so the force's `dist < combinedRadius`
 *   test gives them no push from it, and its count still adds to the density
 *   damping of the points that scan it.
 *
 *   The rotation decides how that sharing falls. Unrotated — a plain modulo —
 *   the same cells share a texel on all four lattices and on every tick: a
 *   point whose texel is shared loses its collision for good, its neighbours
 *   settle into its room, and overlap piles up on it. And with three blocks or
 *   more along a line, the centroid of the outer two lands on the middle one: a
 *   phantom neighbour pushing its points the wrong way. Rotated, the cells
 *   sharing a texel differ from lattice to lattice and from tick to tick, so a
 *   point keeps the passes on which its texel is its own and is never hidden
 *   for long; and as r's second difference never vanishes, the centroid of two
 *   cells symmetric about a third lands 37 cells or more from it, for blocks
 *   up to 31 apart.
 *
 *   Measured (collision only, 8-unit cell, against a 4096² grid, which shares
 *   no texel at these widths; deep overlaps are pairs closer than half the
 *   contact range): 300k points in 1,000 Gaussian clusters (~210k deep at the
 *   start), after 600 steps — 9,000 units wide: unrotated 52,408 deep,
 *   rotated 477, unshared 388; 16,000 units: 104,788, 143 and 63, and
 *   unrotated still climbing (112k at 2,000 steps) where rotated reaches none
 *   by 1,200. A uniform strip three grid widths long at a point per contact
 *   cell, from 117,335 deep: unrotated 189,035 — worse than no collision —
 *   rotated and unshared none. A point midway between two others two grid
 *   widths apart: pushed 5.4 units unrotated, untouched rotated. Sharing does
 *   slow the resolution: those cluster fields, 9,000 to 30,000 units wide,
 *   keep 10% to 71% more overlapping pairs than unshared after 600 steps.
 * - The grid has COLLISION_GRID_SIZE² texels, about a million; a layout
 *   occupying a fair fraction of that many contact cells shares texels on
 *   every pass and resolves slower still. Measured: a million points spread
 *   evenly over a square two grid widths wide (nearly 900k occupied cells) went
 *   from 376k overlapping pairs to 827 in 200 steps, against 121 unshared.
 *
 * The grid accumulates positions relative to the centre of the data box, not
 * to world zero, so its float sums — and the centroids taken from them — are
 * as precise wherever the layout sits as they are around the origin.
 *
 * The two shaders are separate programs, one vertex and one fragment, and GLSL
 * ES allows a highp division to be off by 2.5 ULP — a quotient could round
 * differently in each and put a point right next to a cell boundary in
 * different cells. So, like the many-body grid's formula (grid-cell.ts), this
 * one rounds only in a subtraction and a product, which GLSL ES requires to be
 * correctly rounded: the one inexact step, the reciprocal of the cell size, is
 * taken once on the CPU and passed to both programs as the same uniform bits.
 *
 * The offset passes shift the lattice by half a cell, and the shift is applied
 * after the rounding, in integers: the position is first binned into half
 * cells, `floor((p - o) · 2 / cellSize)`, and a cell is two half cells — `h >> 1`,
 * or `(h + 1) >> 1` on a shifted lattice (an arithmetic shift: floor for
 * negative h too). A shift added in world units would not be exact: ANGLE's
 * Metal backend reassociates float arithmetic, and ran `(p - o) + shift` as
 * `(p + shift) - o` — the same way in the vertex and the fragment program, but
 * not as strict float32 — and `q · s + ½` is the `a·b + c` shape a compiler may
 * fuse into one fma in one program and round twice in the other. Measured, with
 * coordinates planted within 3 ULPs of half-cell boundaries, cells -40,000 to
 * 40,000 from the origin: the vertex and fragment programs agree on every cell,
 * texel and neighbour texel, on all four lattices and with several tick
 * seeds, and match a strict float32 emulation, on Metal and SwiftShader alike.
 */

/**
 * Texels per axis of the collision grid. Fixed, because the grid is a texture
 * and a texture's size cannot follow a box that only the GPU knows. A power of
 * two, so wrapping a cell onto it is a bit mask and its block a bit shift.
 */
export const COLLISION_GRID_SIZE = 1024

const COLLISION_GRID_BITS = Math.log2(COLLISION_GRID_SIZE)

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
const highp int collisionGridMask = ${COLLISION_GRID_SIZE - 1};
const highp int collisionGridBits = ${COLLISION_GRID_BITS};

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
highp int collisionRotation(highp int block, highp uint square, highp uint linear) {
  highp uint k = uint(block);
  return int((square * k * k + linear * k) & uint(collisionGridMask));
}

// The texel a cell hashes to on one lattice's grid this tick: the cell, rotated
// by its blocks, modulo the grid per axis — in [0, collisionGridMask] for any
// cell, negative ones included. Inside the origin's block it is the cell
// itself. tickSeed is this tick's collisionRotationSeed, the same bits in
// every program.
highp ivec2 collisionTexel(highp ivec2 cell, vec2 latticeShift, float tickSeed) {
  highp ivec2 block = cell >> collisionGridBits;
  highp int lattice = int(latticeShift.x * 2.0) + 2 * int(latticeShift.y * 2.0);
  // a and b per lattice (COLLISION_ROTATIONS), b moved on by this tick's seed
  highp uvec4 squares = uvec4(${COLLISION_ROTATIONS.map(([a]) => `${a}u`).join(', ')});
  highp uvec4 linears = uvec4(${COLLISION_ROTATIONS.map(([, b]) => `${b}u`).join(', ')}) + uvec4(uint(tickSeed));
  highp ivec2 rotation = ivec2(
    collisionRotation(block.y, squares[lattice], linears[lattice]),
    collisionRotation(block.x, squares[3 - lattice], linears[3 - lattice]));
  return (cell + rotation) & collisionGridMask;
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
