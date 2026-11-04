/**
 * The one definition of "which cell of the many-body grid is this position in",
 * injected into all four pyramid shaders: calculate-level.vert (aggregation),
 * force-level.frag (the per-level far field), build-nearfield-slots.vert (the
 * near-field peel) and force-nearfield.frag (the near-field force).
 *
 * The level decomposition charges every other point to exactly one pass only
 * while those shaders agree cell for cell — a point binned into one cell by the
 * aggregation and looked up in its neighbour by the force is counted twice or
 * not at all. The grid follows the data: its square is this tick's data bounds
 * (DataBounds), read from a texel, so the formula is longer than the one shared
 * uniform it replaces and lives here once instead of being copied four times.
 *
 * The four shaders are separate programs, two vertex and two fragment, and
 * GLSL ES allows a highp division to be off by 2.5 ULP — so a quotient could
 * round differently from one program to the next and put a point right next to
 * a cell boundary in different cells. The formula therefore uses only
 * operations GLSL ES requires to be correctly rounded, a subtraction and a
 * multiplication, and every program gets the same bits. The one inexact step,
 * the reciprocal of the extent, is taken once by DataBounds and shared through
 * the texel.
 *
 * Every level scales that reciprocal by its power-of-two cell count (8, 16, …),
 * which only changes the exponent: level L+1's scale is exactly twice level
 * L's, so the scaled offset from the origin is exactly twice as large, and
 * floor(2q) ∈ {2·floor(q), 2·floor(q) + 1}: cell(L+1) = 2·cell(L) or
 * 2·cell(L) + 1 on each axis, the parent–child relation the child-block
 * refinement in force-level.frag relies on. The edge clamp preserves it — below the box both
 * levels clamp to 0, above it to N − 1 and 2N − 1 = 2(N − 1) + 1.
 */

/** Marker each pyramid shader carries where the shared code is spliced in. */
const GRID_CELL_MARKER = '// @grid-cell'

/**
 * Spliced in after the host's uniform block, so the host's uniform macros
 * (`#define levelGridSize forceLevelPrecise.levelGridSize`, …) are already in
 * effect and rewrite any matching identifier here as well — which is why every
 * name below differs from every host macro, and withGridCell enforces it.
 * (`packed`, the obvious name for the texel, is reserved in GLSL ES.)
 */
const GRID_CELL_GLSL = /* glsl */`
// This tick's data bounds, one texel: [originX, originY, extent, 1 / extent]
// (DataBounds). Float data — highp, the default sampler precision is lowp.
uniform highp sampler2D dataBoundsTexture;

// The cell holding a world position on a level of cellsPerAxis² cells covering
// the data bounds. Positions outside the box clamp to the edge cells. No
// division: see grid-cell.ts for why every operation here is correctly rounded.
ivec2 gridCell(vec2 worldPosition, float cellsPerAxis) {
  vec4 dataBox = texelFetch(dataBoundsTexture, ivec2(0), 0);
  // Cells per world unit: the shared reciprocal times a power of two — exact.
  float cellsPerUnit = dataBox.w * cellsPerAxis;
  ivec2 lastCell = ivec2(int(cellsPerAxis) - 1);
  return clamp(ivec2(floor((worldPosition - dataBox.xy) * cellsPerUnit)), ivec2(0), lastCell);
}
`

const GRID_CELL_IDENTIFIERS = new Set(GRID_CELL_GLSL.replace(/\/\/.*$/gm, '').match(/\b[A-Za-z_]\w*\b/g))

/**
 * Splices the shared grid-cell code into a pyramid shader at its marker. Throws
 * if the marker is missing, or if a host `#define` would rewrite an identifier
 * of the shared code — both otherwise surface as a shader compile error far
 * from the cause, or not at all.
 */
export function withGridCell (source: string): string {
  if (!source.includes(GRID_CELL_MARKER)) {
    throw new Error(`Shader is missing the "${GRID_CELL_MARKER}" marker for the shared grid-cell code`)
  }
  for (const define of source.match(/^[ \t]*#define[ \t]+\w+/gm) ?? []) {
    const macro = define.replace(/^[ \t]*#define[ \t]+/, '')
    if (GRID_CELL_IDENTIFIERS.has(macro)) {
      throw new Error(`Shader macro "${macro}" collides with an identifier of the shared grid-cell code`)
    }
  }
  return source.replace(GRID_CELL_MARKER, GRID_CELL_GLSL)
}
