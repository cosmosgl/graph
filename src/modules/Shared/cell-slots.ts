/**
 * Per-cell depth-peeled point slots: the grid sizing and slot tiers shared by
 * the many-body near field and the collision force. Both build the same
 * structure with `ForceManyBody/build-nearfield-slots.vert` — K peeling passes
 * that select, per cell, the not-yet-selected point with the smallest per-tick
 * hash — and read it as a `sampler2DArray` with one layer per pass.
 */

/**
 * Finest grid resolution per axis. Also bounds the slot textures, which share
 * the finest level's layout.
 */
export const MAX_GRID_SIZE = 512

/**
 * Finest grid resolution per axis for a point count: ~2·√n, floored at 8²,
 * capped at MAX_GRID_SIZE. Shared by the pyramid allocation and the all-pairs
 * pass's per-tick velocity clamp, which must bound with the same cell size the
 * grid path would use at the same count.
 */
export const getFinestGridSize = (pointsNumber: number): number =>
  Math.min(MAX_GRID_SIZE, Math.max(8, Math.pow(2, Math.ceil(Math.log2(2 * Math.sqrt(pointsNumber))))))

/**
 * How many points per finest-level cell get exact pairwise repulsion each tick.
 * A cell holding at most this many points is sampled exhaustively — its near
 * field is exact. Above it, a fresh random subset is drawn every tick and
 * Horvitz–Thompson weighted; unbiased, but the per-tick re-drawing makes the
 * force estimate noisy in proportion to occupancy/slots. In layouts where
 * something keeps density up (link attraction into hubs, gravity) while alpha
 * stays high, that noise is visible as per-point shimmer.
 *
 * So the slot count scales down as the graph grows: small graphs get enough
 * slots that realistic cell occupancies are covered exactly (the country-scale
 * graph that surfaced the jitter peaks around ~50 points per cell), while large
 * graphs keep the cheap 8-slot estimator — at that scale per-point noise is
 * sub-pixel and the peel cost (slots × points per tick) dominates instead.
 * The slots live in one sampler2DArray layer each, so this is a plain runtime
 * value — no shader changes needed to retune it.
 *
 * Graphs at or below each force's ALL_PAIRS_MAX_POINTS never reach this path at
 * all — they take the exact all-pairs pass instead, so the tiers start above it.
 *
 * The collision force shares the tiers: there a cell holding at most this many
 * points is resolved exactly, and a denser cell resolves against a fresh random
 * subset of its occupants every tick.
 */
export const getNearFieldSlotCount = (pointsNumber: number): number => {
  if (pointsNumber <= 16384) return 32
  if (pointsNumber <= 65536) return 16
  return 8
}
