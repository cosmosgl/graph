import { MAX_REPULSION_SAMPLES, type RepulsionQuality } from '@/graph/config'
import { getFinestGridSize } from '@/graph/modules/Shared/cell-slots'

/**
 * Cells per axis of the coarsest grid level; every finer level doubles it, up to
 * getFinestGridSize. Also the unit of the per-tick origin shift (see
 * ForceManyBody), which pads the data square by one cell of this grid: a
 * seventh of the square's side.
 *
 * 8 rather than 4. The 4² level was the slowest pass, most likely from blending
 * contention: every point is drawn into each level with additive blending, and
 * on 4² about a sixteenth of all points lands on each texel. Dropping it took a
 * third off the step at 100k–300k points (6.9 → 4.6 ms and 19.3 → 12.4 ms on an
 * M3 Max), less at smaller counts. Its centroids each stood in for a sixteenth
 * of the layout, so starting finer is also more accurate: the force error on a
 * 100k-point disk fell from 0.22% to 0.09%. And it keeps the shift's padding to
 * a seventh of the square instead of a third, which would have coarsened every
 * level's cells by as much.
 */
export const COARSEST_GRID_SIZE = 8

/**
 * Up to this many points `simulationRepulsionQuality: 'auto'` keeps far-field
 * centroids two cells away (getShellRadius); above it, one. Below about 25k
 * points a step is bound by the fixed cost of its render passes, not by the far
 * field's reads, so the wider shell is free there: +2 % at 20k points on an
 * Apple M3. From 30k up the far field is the largest part of the step and the
 * wider shell costs a third of it: +29 % at 30k, +31–38 % from 40k to 200k.
 * Per-point jitter also shrinks on screen as points multiply, so large graphs
 * give up the least by taking the narrow shell.
 */
const PRECISE_FAR_FIELD_MAX_POINTS = 25_000

export function usesPreciseFarField (quality: RepulsionQuality, pointsNumber: number): boolean {
  return quality === 'precise' || (quality !== 'fast' && pointsNumber <= PRECISE_FAR_FIELD_MAX_POINTS)
}

/**
 * The floor on the finest-level cell, in world units, applied to the fitted
 * data square: the data-bounds floor is this × the finest grid size. The origin
 * shift pads the square after the floor, so the grid's finest cell is at least
 * this × 8/7 (COARSEST_GRID_SIZE over COARSEST_GRID_SIZE − 1). All points
 * coincident (or a single live point) is a legitimate layout with a zero-size
 * box, and the grid still needs a non-zero cell to index.
 *
 * A quarter of the force kernel's `distanceMin` (1 unit, where its falloff
 * softens from 1/d to 1/√d). The finest grid has 2–4·√n cells per axis below
 * MAX_GRID_SIZE and fewer above it, so the floor binds only once the points'
 * mean spacing drops below about one unit, where the kernel has already
 * softened. Once it binds, every cell is wider than the data needs, which
 * costs the far field accuracy: at one unit per cell it bound on a 100k-point
 * square a tenth of the space wide (mean spacing 1.3 units) and raised its
 * error 0.06% → 0.30% (measured before the shift's padding existed).
 */
export const MIN_FINEST_CELL_SIZE = 0.25

/**
 * The automatic near-field slot count, used when `simulationRepulsionSamples`
 * is not set. A cell holding at most K points is sampled exhaustively — its
 * near field is exact. Above it, a fresh random subset is drawn every tick and
 * Horvitz–Thompson weighted; unbiased, but the per-tick re-drawing makes the
 * force estimate noisy in proportion to occupancy/K, which shows as per-point
 * shimmer wherever something keeps density up (link attraction into hubs,
 * gravity, a cluster force) while alpha stays high.
 *
 * K is chosen from two measured quantities, and the smaller wins:
 *
 * - What the layout wants: the smallest power of two that samples the finest
 *   cells of all but OCCUPANCY_MISS of the points whole (see occupancy.frag),
 *   read back without blocking every OCCUPANCY_INTERVAL steps, never more often
 *   than OCCUPANCY_HOLD_SHARE of the time spent holding frames for them allows.
 *   Sized to the points, not the cells: a dense core of a few percent of the
 *   points jitters visibly while the typical point's cell holds a handful. The
 *   point count alone cannot see this: at the same count a clustered layout
 *   fills its cells far beyond a scattered one.
 * - What the size can afford: K × points, the peel work per tick, is held under
 *   a budget measured where the frame leaves vsync on a laptop GPU, and the K
 *   slot layers at the finest grid under a memory cap: the 32 MiB the size
 *   tiers held at the 512² grid (16 slots), which fits up to 64 on a smaller
 *   grid. Both limit how high K goes, never below MIN_AUTO_SLOTS: past 200,000
 *   points the floor alone spends more than the budget, as the size tiers' 8 did.
 *
 * Both are clamped to [MIN_AUTO_SLOTS, MAX_AUTO_SLOTS]; the ceiling is the one a
 * configured count is validated against (MAX_REPULSION_SAMPLES), so every count
 * this force runs can be allocated. The slots live in one array-texture layer
 * each, so a changed K is a reallocation, not a shader change. Graphs at or
 * below ALL_PAIRS_MAX_POINTS never reach this path at all — they take the exact
 * all-pairs pass instead.
 */
export const MIN_AUTO_SLOTS = 8
const MAX_AUTO_SLOTS = MAX_REPULSION_SAMPLES
/**
 * Point-samples per tick above which the automatic count does not rise. A ceiling on the
 * count, not on the work: the count never goes below MIN_AUTO_SLOTS, which past 200,000
 * points spends more than this, as the size tiers' 8 did.
 */
const NEAR_FIELD_BUDGET = 1.6e6
/** Bytes the automatic choice may give the slot arrays: K layers of finest-grid rg32float texels. */
const NEAR_FIELD_MEMORY_BUDGET = 32 * 1024 * 1024
/** Simulation steps between occupancy measurements. */
export const OCCUPANCY_INTERVAL = 30
/**
 * Share of the points the automatic count may leave in cells fuller than it, where they are
 * sampled rather than listed and their force jitters from tick to tick.
 */
const OCCUPANCY_MISS = 0.01
/** The power of two at or below `value`, clamped to [min, max]. */
const floorPowerOfTwo = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.pow(2, Math.floor(Math.log2(value)))))

/** The largest power-of-two slot count whose per-tick work and slot memory fit the budgets at this size. */
export const getAffordableSlotCount = (pointsNumber: number): number => {
  const layerBytes = getFinestGridSize(pointsNumber) ** 2 * 8
  const affordable = Math.min(NEAR_FIELD_BUDGET / Math.max(1, pointsNumber), NEAR_FIELD_MEMORY_BUDGET / layerBytes)
  return floorPowerOfTwo(affordable, MIN_AUTO_SLOTS, MAX_AUTO_SLOTS)
}

/**
 * The smallest power-of-two slot count, MIN_AUTO_SLOTS to MAX_AUTO_SLOTS, that leaves at most
 * OCCUPANCY_MISS of the points in cells fuller than it. `overflow` holds the points in cells
 * fuller than MIN_AUTO_SLOTS and each doubling below the ceiling (occupancy.frag).
 */
export const getWantedSlotCount = (points: number, overflow: readonly number[]): number => {
  let count = MIN_AUTO_SLOTS
  for (const over of overflow) {
    if (over <= OCCUPANCY_MISS * points) return count
    count *= 2
  }
  return Math.min(count, MAX_AUTO_SLOTS)
}

/**
 * At or below this point count the whole force is computed exactly: one
 * all-pairs O(n²) pass (force-allpairs.frag) replaces the grid pyramid and the
 * Monte-Carlo near field. Two reasons it wins there:
 *
 * - Zero sampling noise at any cell occupancy. The sampled near field is only
 *   exact while a cell holds ≤ slot-count points; a small dense graph (hubs
 *   held tight by links or gravity) can concentrate hundreds of points in one
 *   finest cell, and the per-tick re-sampled estimate then jitters visibly.
 * - It's cheaper. Depth peeling is inherently sequential — one render pass per
 *   slot — and at small point counts that fixed per-pass cost dominates the
 *   actual work (measured ~6ms/step for 64 slots at 2k points, vs ~1ms for the
 *   single all-pairs pass whose n² texel loop is trivial at this scale).
 *
 * The crossover is set by the n² fragment work: 4096² ≈ 17M pair evaluations
 * per step stays around a millisecond on modest GPUs, while the next power of
 * two would already cost several.
 */
export const ALL_PAIRS_MAX_POINTS = 4096
