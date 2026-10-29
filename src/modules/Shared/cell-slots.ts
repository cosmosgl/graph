/**
 * Per-cell depth-peeled point slots: the grid sizing the many-body near field
 * and the collision force share, and the collision force's slot tiers. Both
 * build the same structure with `ForceManyBody/build-nearfield-slots.vert` — K
 * peeling passes that select, per cell, the not-yet-selected point with the
 * smallest per-tick hash — and read it from array textures with one layer per
 * pass. The collision force takes its K from the point count here. The
 * many-body force measures its K from the cells in Graph's render loop
 * (ForceManyBody) and takes these tiers wherever it has no measurement.
 */

/**
 * Finest grid resolution per axis. Also bounds the slot textures, which share
 * the finest level's layout.
 */
export const MAX_GRID_SIZE = 512

/**
 * Finest grid resolution per axis for a point count: ~2·√n, floored at 8²,
 * capped at MAX_GRID_SIZE. Shared by the pyramid allocation and the per-tick
 * kick bound both many-body paths take from it (ForceManyBody's getMaxStep).
 */
export const getFinestGridSize = (pointsNumber: number): number =>
  Math.min(MAX_GRID_SIZE, Math.max(8, Math.pow(2, Math.ceil(Math.log2(2 * Math.sqrt(pointsNumber))))))

/**
 * The collision force's slots per hash bucket for a point count. A bucket
 * holding at most this many points is listed exhaustively; a denser bucket
 * supplies a fresh random subset every pass, so every overlapping pair is
 * reached sooner or later. Distant world cells can share a bucket's slot
 * budget. The count scales down as the graph grows: the peel cost is slots ×
 * points per pass, and at large counts a bucket holds few points anyway. The
 * slots live in one array-texture layer each, so this is a plain runtime
 * value — no shader changes needed to retune it. The many-body force's
 * automatic near-field count runs it too, until its first occupancy
 * measurement lands and throughout on a host that never measures (a headless
 * graph, a graph without its render loop, a GraphSimulation): retuning these
 * tiers changes that count too, within the many-body force's own time and
 * memory caps, which bind first above 16,384 points (ForceManyBody's
 * nearFieldSlotCount).
 *
 * Graphs at or below ALL_PAIRS_MAX_POINTS never reach this path at all — they
 * take the exact all-pairs pass instead, so the tiers start above it.
 */
export const getNearFieldSlotCount = (pointsNumber: number): number => {
  if (pointsNumber <= 16384) return 32
  if (pointsNumber <= 65536) return 16
  return 8
}
