import { Buffer, Framebuffer, Texture, TextureView, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule, BASE_PIPELINE_PARAMETERS } from '@/graph/modules/core-module'
import { MAX_REPULSION_SAMPLES, isRepulsionSampleCount } from '@/graph/config'

import calculateLevelFrag from '@/graph/modules/ForceManyBody/calculate-level.frag?raw'
import calculateLevelPreciseVert from '@/graph/modules/ForceManyBody/calculate-level.vert?raw'
import forceLevelPreciseFrag from '@/graph/modules/ForceManyBody/force-level.frag?raw'
import forceNearFieldFrag from '@/graph/modules/ForceManyBody/force-nearfield.frag?raw'
import forceAllPairsFrag from '@/graph/modules/ForceManyBody/force-allpairs.frag?raw'
import buildNearFieldSlotsVert from '@/graph/modules/ForceManyBody/build-nearfield-slots.vert?raw'
import buildNearFieldSlotsFrag from '@/graph/modules/ForceManyBody/build-nearfield-slots.frag?raw'
import occupancyFrag from '@/graph/modules/ForceManyBody/occupancy.frag?raw'
import { withGridCell } from '@/graph/modules/ForceManyBody/grid-cell'
import { PickingReadback } from '@/graph/modules/Points/picking-readback'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import { DataBounds } from '@/graph/modules/Shared/data-bounds'
import { getFinestGridSize, getNearFieldSlotCount } from '@/graph/modules/Shared/cell-slots'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

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

/**
 * Chebyshev radius of the shell a level leaves to the next. With the precise
 * far field it is 2 (a 5×5 block of cells) on every level but the finest;
 * otherwise, and always on the finest level, 1 (3×3), which the near-field pass
 * closes. The next level refines a shell of radius r as its aligned (4r+2)²
 * child block minus its own shell (force-level.frag), which fits inside the
 * block as long as r(L+1) ≤ 2·r(L).
 *
 * A cell's centroid stands in for its points with an error that falls with the
 * square of the distance in cell sizes, so a lump used from two cells away
 * carries about a quarter of the error of one used from one cell away. On
 * uniform data either is small. On clustered data a coarse cell holds much of
 * a cluster or splits one, its centroid stands for very uneven mass, and with
 * the grid shifting every tick (drawBounds) the one-cell error reaches every
 * point as visible jitter while alpha is high: on 22,500 points in 25 clusters
 * with alpha held at 1, 0.023 point spacings per tick against 0.009 with the
 * two-cell shell, most of it coherent. The finest level's cells hold about one
 * point each (getFinestGridSize), so their centroids are exact and its shell
 * stays 3×3, which keeps the near field's cost where it was.
 */
const getShellRadius = (level: number, levels: number, precise: boolean): number =>
  (precise && level !== levels - 1 ? 2 : 1)

/**
 * The per-tick bound on the close-range repulsion kick, for both paths: the
 * all-pairs pass (which also splits near from far pairs at it) and the grid
 * path's near-field pass. It is the kick span (Store.kickSpan, 2 × spaceSize)
 * over the finest grid size at this point count — twice the finest cell the
 * grid had when it covered the space: a fixed length, deliberately not tied to
 * the grid's actual cell. The grid follows the data, and a cell-relative bound
 * would tighten as a layout contracts, throttling the kicks that break dense
 * clumps apart exactly when they are needed. One helper so both passes bound
 * with the same value and the dynamics stay continuous across
 * ALL_PAIRS_MAX_POINTS.
 */
const getMaxStep = (kickSpan: number, pointsNumber: number): number =>
  kickSpan / getFinestGridSize(pointsNumber)

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
const MIN_FINEST_CELL_SIZE = 0.25

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
const MIN_AUTO_SLOTS = 8
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
const OCCUPANCY_INTERVAL = 30
/**
 * Share of the time the readings may hold frames. A reading holds the next frame until the GPU
 * has drained what was queued ahead of its copy: nothing where the GPU keeps up, a few hundred
 * milliseconds on a GPU-bound loop. After a reading that held a frame for h ms, the next waits at
 * least h / OCCUPANCY_HOLD_SHARE, however few steps that is.
 */
const OCCUPANCY_HOLD_SHARE = 0.01
/**
 * Share of the points the automatic count may leave in cells fuller than it, where they are
 * sampled rather than listed and their force jitters from tick to tick.
 */
const OCCUPANCY_MISS = 0.01
/**
 * The occupancy pass, counting the points in cells fuller than MIN_AUTO_SLOTS, twice and four
 * times it. The floor comes from the constant; the three thresholds, and getWantedSlotCount's
 * three overflow sums with their doubling, assume the counts 8 to 64 run in four doublings.
 */
const OCCUPANCY_FRAG = occupancyFrag.replace('// @min-auto-slots', `#define MIN_AUTO_SLOTS ${MIN_AUTO_SLOTS}`)
/** Blocks per axis the occupancy pass reduces the finest level into (its readback is this²). */
const OCCUPANCY_BLOCKS = 16

/** The power of two at or below `value`, clamped to [min, max]. */
const floorPowerOfTwo = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.pow(2, Math.floor(Math.log2(value)))))

/** The largest power-of-two slot count whose per-tick work and slot memory fit the budgets at this size. */
const getAffordableSlotCount = (pointsNumber: number): number => {
  const layerBytes = getFinestGridSize(pointsNumber) ** 2 * 8
  const affordable = Math.min(NEAR_FIELD_BUDGET / Math.max(1, pointsNumber), NEAR_FIELD_MEMORY_BUDGET / layerBytes)
  return floorPowerOfTwo(affordable, MIN_AUTO_SLOTS, MAX_AUTO_SLOTS)
}

/**
 * The smallest power-of-two slot count, MIN_AUTO_SLOTS to MAX_AUTO_SLOTS, that leaves at most
 * OCCUPANCY_MISS of the points in cells fuller than it. `overflow` holds the points in cells
 * fuller than MIN_AUTO_SLOTS and each doubling below the ceiling (occupancy.frag).
 * @internal Exported for the tests.
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
const ALL_PAIRS_MAX_POINTS = 4096

/** A grid-level aggregation target ([sum(x), sum(y), count, 0] per cell). */
type LevelTarget = {
  texture: Texture;
  fbo: Framebuffer;
  /** Cells per axis of the grid this level represents. */
  gridSize: number;
}

/** The near-field slots alternate between this many array textures (see NearFieldSlots). */
const SLOT_ARRAYS = 2

/**
 * The near-field point slots: one depth-peeling pass per slot over the finest
 * level's grid, each holding [point index, hash] per cell, rebuilt every tick
 * (build-nearfield-slots.vert). Pass k samples pass k−1's output, and sampling
 * one layer of a texture while rendering to another layer of the same texture
 * is a WebGL feedback loop. So slot k is layer k / 2 of arrays[k % 2], pass k
 * renders into that layer and samples the other array, and the force pass
 * reads both. Peeling into a pair of 2D targets and copying each pass into
 * its layer of one array costs about as much again as the passes at small
 * point counts, each copy its own encoder and submit. One depth attachment
 * serves every pass, since each clears it.
 */
type NearFieldSlots = {
  /** Peeling passes per tick. */
  count: number;
  /** Cells per axis of every target — the finest level's grid. */
  gridSize: number;
  /** Even slots in [0], odd slots in [1], each ceil(count / 2) layers deep. */
  arrays: Texture[];
  depth: Texture;
  /** One per slot, its layer of the arrays. A framebuffer does not own a view it is given. */
  views: TextureView[];
  /** One per slot, attaching its layer and the shared depth. */
  fbos: Framebuffer[];
}

/**
 * GPU many-body (repulsion) force.
 *
 * Graphs at or below ALL_PAIRS_MAX_POINTS are computed exactly in a single
 * all-pairs pass (see that constant for why). Above it:
 *
 * A Barnes-Hut-style grid pyramid (each level refines the shell of cells the
 * level above left around the point, minus its own shell: 5×5 or 3×3 by
 * simulationRepulsionQuality on every level but the finest, getShellRadius)
 * whose finest 3×3 neighborhood is closed by an
 * unbiased Monte-Carlo near field: a per-tick depth-peeled random subset of each
 * cell's points, Horvitz–Thompson-weighted so the expected force equals the exact
 * all-pairs sum. Close points therefore repel each other individually instead of
 * through a cell centroid, which keeps dense hubs from collapsing into disks and
 * petals. Small/sparse graphs land at most one point per cell, so the near field
 * samples each cell exhaustively and the far cells' centroids are exact — the
 * approximation only kicks in once cells hold more points than sampling slots.
 *
 * The pyramid covers the data, not the space: every tick DataBounds reduces the
 * live points to their bounding square on the GPU, and every level divides that
 * square (grid-cell.ts). A space-anchored grid gave a layout covering a fraction
 * f of each axis only f² of the cells — an average of n/(R·f)² points per finest
 * cell for R cells per axis, at most 0.25/f² below 65k points but 0.38/f² at
 * 100k, past the 8 near-field slots there once f drops below ~0.22 — and binned
 * points outside the space into its edge cells. Following the data makes the
 * resolution depend on the point count alone, wherever the layout sits.
 *
 * Where that square's cell boundaries fall moves every tick (DataBounds'
 * originShift). Each level picks the cells it takes as centroids from the
 * point's own cell, so a point crossing a boundary swaps whole cells between
 * "one centroid" and "refined by the next level", and the force jumps there. A
 * fixed grid keeps those jumps on fixed lines, and every boundary of the
 * coarsest level is a boundary on every finer level, so the jumps along it add
 * up. A dense layout settled into a visible cross along the square's centre
 * lines, its points pushed off them: there a crossing switches a column of
 * coarsest cells on both sides, where near the box's edge the shell is clipped
 * and only one column switches. Padding the square by one coarsest cell and
 * sliding it by a uniform random part of that cell turns each jump into
 * per-tick noise around a continuous force, annealed by alpha like the near
 * field's sampling noise. Unlike that noise it reaches every point, however
 * sparse its cell: at a 300k-point equilibrium with alpha held at 1 the layout
 * moves 0.0023 point spacings per tick instead of 0.001. The price is a seventh
 * more extent per axis for the same cell count, so occupied cells hold ~1.3×
 * the points, which costs ~6% of a step at 100k–300k points (+0.25 ms and
 * +0.8 ms on an M3 Max, against the same pyramid without the shift).
 */
export class ForceManyBody extends CoreModule {
  private randomValuesTexture: Texture | undefined
  private pointIndices: Buffer | undefined
  /** Grid level count; `0` until create() allocates the pyramid. */
  private levels = 0
  private levelTargets = new Map<number, LevelTarget>()
  /** Near-field slots over the finest grid level; `undefined` until create() allocates them. */
  private nearField: NearFieldSlots | undefined

  private calculateLevelsCommand: Model | undefined
  private forceLevelCommand: Model | undefined
  private buildNearFieldSlotsCommand: Model | undefined
  private forceNearFieldCommand: Model | undefined
  private forceAllPairsCommand: Model | undefined

  private forceVertexCoordBuffer: Buffer | undefined

  /** This tick's data bounds — the square every grid level divides (grid path only). */
  private dataBounds: DataBounds | undefined

  private calculateLevelsUniformStore: UniformStore<{
    calculateLevelsPreciseUniforms: {
      levelGridSize: number;
    };
  }> | undefined

  private forceLevelUniformStore: UniformStore<{
    forceLevelPreciseUniforms: {
      levelGridSize: number;
      isFirstLevel: number;
      alpha: number;
      repulsion: number;
      shellRadius: number;
      parentShellRadius: number;
    };
  }> | undefined

  private buildNearFieldSlotsUniformStore: UniformStore<{
    buildNearFieldSlotsUniforms: {
      pointsTextureSize: number;
      levelGridSize: number;
      hasPreviousSlot: number;
      randomSeed: number;
      previousLayer: number;
    };
  }> | undefined

  private forceNearFieldUniformStore: UniformStore<{
    forceNearFieldUniforms: {
      pointsTextureSize: number;
      levelGridSize: number;
      maxStep: number;
      alpha: number;
      repulsion: number;
      slotCount: number;
    };
  }> | undefined

  private forceAllPairsUniformStore: UniformStore<{
    forceAllPairsUniforms: {
      pointsTextureSize: number;
      pointsNumber: number;
      alpha: number;
      repulsion: number;
      maxStep: number;
    };
  }> | undefined

  private previousPointsTextureSize: number | undefined
  private previousPointsNumber: number | undefined

  /** Reduces the finest level's counts into OCCUPANCY_BLOCKS² block statistics (occupancy.frag). */
  private occupancyCommand: Model | undefined
  private occupancyTarget: { texture: Texture; fbo: Framebuffer } | undefined
  private occupancyReadback: PickingReadback | undefined
  /**
   * A reduction is in the target and waits for its copy. A step in a frame of `Graph`'s
   * render loop draws it (measureOccupancy); the copy is issued by `issueOccupancy()` at the
   * frame's end and collected by `collectOccupancy()` before the next frame queues any pass,
   * like the other non-blocking reads (GraphSimulation.collectReadbacks / issueReadbacks).
   */
  private isOccupancyIssueWanted = false
  /**
   * Grid-path steps of the render loop's frames that could measure (the count automatic,
   * the size affording more than MIN_AUTO_SLOTS) since the measurement last restarted;
   * schedules the measurements.
   */
  private occupancyTick = 0
  /** The `occupancyTick` of the last reduction drawn, `undefined` until the first since a restart. */
  private lastOccupancyTick: number | undefined
  /**
   * The `performance.now()` before which no measurement is drawn: the last reading's hold
   * divided by OCCUPANCY_HOLD_SHARE, so the holds take about that share of the time however
   * slow the GPU. A restart keeps it: a new point count or a toggled key on a loaded GPU
   * waits like any other measurement.
   */
  private occupancyNotBefore = 0
  /**
   * The automatic slot count in force, `undefined` until the first measurement
   * lands (the point count's size tier applies meanwhile, getNearFieldSlotCount, and
   * throughout on a host that never measures). A change takes two consecutive
   * measurements that agree, so a layout settling at a boundary does not
   * reallocate the slot arrays every measurement; `proposedSlotCount` holds the
   * one awaiting confirmation.
   */
  private autoSlotCount: number | undefined
  private proposedSlotCount: number | undefined

  private occupancyUniformStore: UniformStore<{
    occupancyUniforms: {
      levelTextureWidth: number;
      levelTextureHeight: number;
      blockWidth: number;
      blockHeight: number;
    };
  }> | undefined

  /** Whether the GPU has yet to reach the occupancy copy in flight. @internal */
  public get isOccupancyReadbackPending (): boolean {
    return this.occupancyReadback?.isPending ?? false
  }

  /** Whether an occupancy copy is in flight, landed or not, and still to be collected. @internal */
  public get hasPendingOccupancyReadback (): boolean {
    return this.occupancyReadback?.inFlight ?? false
  }

  /** Small graphs skip the grid + Monte-Carlo machinery entirely (see ALL_PAIRS_MAX_POINTS). */
  private get usesAllPairs (): boolean {
    return (this.data.pointsNumber ?? 0) <= ALL_PAIRS_MAX_POINTS
  }

  /**
   * Whether this tick's far field keeps centroids two cells away
   * (simulationRepulsionQuality; 'auto' tiers by PRECISE_FAR_FIELD_MAX_POINTS).
   * Read every tick: the shell is a per-level uniform, so the setting applies
   * to the next step without rebuilding anything.
   */
  private get preciseFarField (): boolean {
    const quality = this.config.simulationRepulsionQuality
    if (quality === 'precise') return true
    if (quality === 'fast') return false
    return (this.data.pointsNumber ?? 0) <= PRECISE_FAR_FIELD_MAX_POINTS
  }

  /**
   * Peeling passes per tick, i.e. layers across the slot arrays. The force
   * pass loops over a slotCount uniform, so a changed value reallocates the
   * arrays on the next tick. The configured count when there is one; otherwise
   * the measured want, capped by what the size affords (see MIN_AUTO_SLOTS).
   * Before the first measurement lands, the point count's size tier, which a
   * host that steps the simulation itself runs throughout (see measureOccupancy).
   * A value written to the config directly, past validateConfig, counts only if it
   * is a valid count: anything else falls back to the automatic count, so it never
   * reaches an allocation. A direct write is no setter: nothing restarts the
   * measurement, which resumes from where it stood.
   */
  private get nearFieldSlotCount (): number {
    const configured = this.config.simulationRepulsionSamples
    if (isRepulsionSampleCount(configured)) return configured
    const pointsNumber = this.data.pointsNumber ?? 0
    return Math.min(this.autoSlotCount ?? getNearFieldSlotCount(pointsNumber), getAffordableSlotCount(pointsNumber))
  }

  private get usesAutoSlotCount (): boolean {
    return !isRepulsionSampleCount(this.config.simulationRepulsionSamples)
  }

  public create (): void {
    const { device, store } = this
    if (!store.pointsTextureSize) return

    // A changed point count is a new layout, measured afresh on the next tick: a read in
    // flight describes the previous points. A data apply of the same count (positions
    // streamed in, forces marked dirty) keeps the measurement as it runs — the count in
    // force, the proposal awaiting its second reading, the schedule and a read in flight
    // (its buffer is not touched here). Restarting it on every apply would cancel each
    // read before it landed, and an update every step would never be measured.
    if (this.data.pointsNumber !== this.previousPointsNumber) this.restartOccupancyMeasurement()

    // (Re)allocate the grid pyramid + near-field slots for the current point
    // count (resizing levels and dropping any that the pyramid no longer needs).
    // Small graphs take the exact all-pairs pass and don't need any of it —
    // drop whatever a previously larger graph left behind.
    if (this.usesAllPairs) {
      this.destroyLevelTargets()
      this.levels = 0
    } else {
      this.createLevels()
    }

    // Random jitter texture to prevent sticking
    const totalPixels = store.pointsTextureSize * store.pointsTextureSize
    const randomValuesState = new Float32Array(totalPixels * 4)
    for (let i = 0; i < totalPixels; ++i) {
      randomValuesState[i * 4] = store.getRandomFloat(-1, 1) * 0.00001
      randomValuesState[i * 4 + 1] = store.getRandomFloat(-1, 1) * 0.00001
    }

    const recreateRandomValuesTexture =
      !this.randomValuesTexture ||
      this.randomValuesTexture.destroyed ||
      this.randomValuesTexture.width !== store.pointsTextureSize ||
      this.randomValuesTexture.height !== store.pointsTextureSize

    if (recreateRandomValuesTexture) {
      if (this.randomValuesTexture && !this.randomValuesTexture.destroyed) {
        this.randomValuesTexture.destroy()
      }
      this.randomValuesTexture = device.createTexture({
        width: store.pointsTextureSize,
        height: store.pointsTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.COPY_DST,
      })
    }
    this.randomValuesTexture!.copyImageData({
      data: randomValuesState,
      bytesPerRow: getBytesPerRow('rgba32float', store.pointsTextureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    })

    // Update pointIndices buffer if pointsTextureSize changed
    if (!this.pointIndices || this.previousPointsTextureSize !== store.pointsTextureSize) {
      if (this.pointIndices && !this.pointIndices.destroyed) {
        this.pointIndices.destroy()
      }
      const indexData = createIndexesForBuffer(store.pointsTextureSize)
      this.pointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
      this.calculateLevelsCommand?.setAttributes({
        pointIndices: this.pointIndices,
      })
      this.buildNearFieldSlotsCommand?.setAttributes({
        pointIndices: this.pointIndices,
      })
    }

    this.previousPointsTextureSize = store.pointsTextureSize
    this.previousPointsNumber = this.data.pointsNumber
  }

  public initPrograms (): void {
    const { device, store, data, points } = this
    if (!data.pointsNumber || !points || !store.pointsTextureSize) return

    this.forceVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    // Allocates its fixed-size targets on its first run, so an all-pairs graph never does.
    this.dataBounds ||= new DataBounds(device)

    // Occupancy reduction (fullscreen quad over the block target; its readback
    // drives the automatic slot count).
    this.occupancyUniformStore ||= new UniformStore(device, {
      occupancyUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          levelTextureWidth: 'f32',
          levelTextureHeight: 'f32',
          blockWidth: 'f32',
          blockHeight: 'f32',
        },
        defaultUniforms: {
          levelTextureWidth: 0,
          levelTextureHeight: 0,
          blockWidth: 0,
          blockHeight: 0,
        },
      },
    })

    this.occupancyCommand ||= new Model(device, {
      fs: OCCUPANCY_FRAG,
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.forceVertexCoordBuffer,
      },
      bufferLayout: [
        { name: 'vertexCoord', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        occupancyUniforms: this.occupancyUniformStore.getManagedUniformBuffer('occupancyUniforms'),
        // levelTexture is bound per measurement in measureOccupancy()
      },
      parameters: {
        ...BASE_PIPELINE_PARAMETERS,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })

    if (!this.occupancyTarget || this.occupancyTarget.texture.destroyed) {
      const texture = device.createTexture({
        width: OCCUPANCY_BLOCKS,
        height: OCCUPANCY_BLOCKS,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER,
      })
      const fbo = device.createFramebuffer({
        width: OCCUPANCY_BLOCKS,
        height: OCCUPANCY_BLOCKS,
        colorAttachments: [texture],
      })
      this.occupancyTarget = { texture, fbo }
    }

    // Grid aggregation command (point list, additive blend)
    this.calculateLevelsUniformStore ||= new UniformStore(device, {
      calculateLevelsPreciseUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          levelGridSize: 'f32',
        },
        defaultUniforms: {
          levelGridSize: 0,
        },
      },
    })

    this.calculateLevelsCommand ||= new Model(device, {
      fs: calculateLevelFrag,
      vs: withGridCell(calculateLevelPreciseVert),
      topology: 'point-list',
      vertexCount: data.pointsNumber,
      attributes: {
        ...this.pointIndices && { pointIndices: this.pointIndices },
      },
      bufferLayout: [
        { name: 'pointIndices', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        calculateLevelsPreciseUniforms: this.calculateLevelsUniformStore.getManagedUniformBuffer('calculateLevelsPreciseUniforms'),
        // All texture bindings will be set dynamically in drawLevels() method
      },
      parameters: {
        ...BASE_PIPELINE_PARAMETERS,
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'one',
        blendColorDstFactor: 'one',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })

    // Per-level force command (fullscreen quad, additive into velocityFbo)
    this.forceLevelUniformStore ||= new UniformStore(device, {
      forceLevelPreciseUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          levelGridSize: 'f32',
          isFirstLevel: 'f32',
          alpha: 'f32',
          repulsion: 'f32',
          shellRadius: 'f32',
          parentShellRadius: 'f32',
        },
        defaultUniforms: {
          levelGridSize: 0,
          isFirstLevel: 0,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
          shellRadius: 2,
          parentShellRadius: 0,
        },
      },
    })

    this.forceLevelCommand ||= new Model(device, {
      fs: withGridCell(forceLevelPreciseFrag),
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.forceVertexCoordBuffer,
      },
      bufferLayout: [
        { name: 'vertexCoord', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        forceLevelPreciseUniforms: this.forceLevelUniformStore.getManagedUniformBuffer('forceLevelPreciseUniforms'),
        // All texture bindings will be set dynamically in drawForces() method
      },
      parameters: {
        ...BASE_PIPELINE_PARAMETERS,
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'one',
        blendColorDstFactor: 'one',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })

    // Near-field slot peeling command (point list; the depth test selects the
    // eligible point with the smallest per-tick hash per cell)
    this.buildNearFieldSlotsUniformStore ||= new UniformStore(device, {
      buildNearFieldSlotsUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
          levelGridSize: 'f32',
          hasPreviousSlot: 'f32',
          randomSeed: 'f32',
          previousLayer: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize,
          levelGridSize: 0,
          hasPreviousSlot: 0,
          randomSeed: 0,
          previousLayer: 0,
        },
      },
    })

    this.buildNearFieldSlotsCommand ||= new Model(device, {
      fs: buildNearFieldSlotsFrag,
      vs: withGridCell(buildNearFieldSlotsVert),
      topology: 'point-list',
      vertexCount: data.pointsNumber,
      attributes: {
        ...this.pointIndices && { pointIndices: this.pointIndices },
      },
      bufferLayout: [
        { name: 'pointIndices', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        buildNearFieldSlotsUniforms: this.buildNearFieldSlotsUniformStore.getManagedUniformBuffer('buildNearFieldSlotsUniforms'),
        // All texture bindings will be set dynamically in drawNearFieldSlots() method
      },
      parameters: {
        ...BASE_PIPELINE_PARAMETERS,
        blend: false,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    })

    // Near-field force command (fullscreen quad — the P3M close-range pass)
    this.forceNearFieldUniformStore ||= new UniformStore(device, {
      forceNearFieldUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
          levelGridSize: 'f32',
          maxStep: 'f32',
          alpha: 'f32',
          repulsion: 'f32',
          slotCount: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize,
          levelGridSize: 0,
          maxStep: 0,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
          slotCount: 0,
        },
      },
    })

    // Exact all-pairs command (fullscreen quad — the small-graph path)
    this.forceAllPairsUniformStore ||= new UniformStore(device, {
      forceAllPairsUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
          pointsNumber: 'f32',
          alpha: 'f32',
          repulsion: 'f32',
          maxStep: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize,
          pointsNumber: data.pointsNumber,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
          maxStep: 0,
        },
      },
    })

    this.forceAllPairsCommand ||= new Model(device, {
      fs: forceAllPairsFrag,
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.forceVertexCoordBuffer,
      },
      bufferLayout: [
        { name: 'vertexCoord', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        forceAllPairsUniforms: this.forceAllPairsUniformStore.getManagedUniformBuffer('forceAllPairsUniforms'),
        // All texture bindings will be set dynamically in drawAllPairsForce() method
      },
      parameters: BASE_PIPELINE_PARAMETERS,
    })

    this.forceNearFieldCommand ||= new Model(device, {
      fs: withGridCell(forceNearFieldFrag),
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.forceVertexCoordBuffer,
      },
      bufferLayout: [
        { name: 'vertexCoord', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        forceNearFieldUniforms: this.forceNearFieldUniformStore.getManagedUniformBuffer('forceNearFieldUniforms'),
        // All texture bindings will be set dynamically in drawForces() method
      },
      parameters: {
        ...BASE_PIPELINE_PARAMETERS,
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'one',
        blendColorDstFactor: 'one',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })
  }

  /** @param isHeld - The step runs in a held frame (SimulationStepOptions.held), the only place it measures occupancy. */
  public run (isHeld = false): void {
    // Skip if point topology changed and create() wasn't called yet. Space size
    // is intentionally not guarded: grid allocation is point-count-based, the
    // grid's placement is recomputed from the data every tick (drawBounds), and
    // the kick bound reads the live store.kickSpan.
    if (
      this.store.pointsTextureSize !== this.previousPointsTextureSize ||
      this.data.pointsNumber !== this.previousPointsNumber
    ) {
      return
    }

    // Small graphs: one exact all-pairs pass, no grid, no sampling.
    if (this.usesAllPairs) {
      this.drawAllPairsForce()
      return
    }

    // A changed slot count — a configuration change or an occupancy measurement
    // collected before this step (collectOccupancy) — reallocates the slot arrays in
    // place; the levels are untouched.
    if (this.nearField && this.nearField.count !== this.nearFieldSlotCount) this.createLevels()
    // Nothing to do until the grid pyramid and near-field slots are allocated
    // (create() builds them; this guards a partial/failed allocation).
    const finest = this.levelTargets.get(this.levels - 1)
    if (!finest || !this.nearField) return

    // Bounds first, once per tick: the passes below all index the grid they
    // define, and must index the same one — the aggregation and the forces
    // binning against different boxes would break the decomposition's
    // exactly-once coverage.
    this.drawBounds()
    if (!this.dataBounds?.texture) return
    this.drawLevels()
    this.measureOccupancy(finest.texture, finest.gridSize, isHeld)
    this.drawNearFieldSlots()
    this.drawForces()
  }

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   */
  public destroy (): void {
    // 1. Destroy Models FIRST (they destroy _gpuGeometry if exists, and _uniformStore)
    this.calculateLevelsCommand?.destroy()
    this.calculateLevelsCommand = undefined
    this.forceLevelCommand?.destroy()
    this.forceLevelCommand = undefined
    this.buildNearFieldSlotsCommand?.destroy()
    this.buildNearFieldSlotsCommand = undefined
    this.forceNearFieldCommand?.destroy()
    this.forceNearFieldCommand = undefined
    this.forceAllPairsCommand?.destroy()
    this.forceAllPairsCommand = undefined
    this.occupancyCommand?.destroy()
    this.occupancyCommand = undefined
    this.occupancyReadback?.destroy()
    this.occupancyReadback = undefined

    // 2. Destroy Framebuffers + 3. Textures (grid targets destroy their FBOs
    // before their textures internally)
    if (this.randomValuesTexture && !this.randomValuesTexture.destroyed) {
      this.randomValuesTexture.destroy()
    }
    this.randomValuesTexture = undefined
    this.destroyLevelTargets()
    if (this.occupancyTarget) {
      if (!this.occupancyTarget.fbo.destroyed) this.occupancyTarget.fbo.destroy()
      if (!this.occupancyTarget.texture.destroyed) this.occupancyTarget.texture.destroy()
      this.occupancyTarget = undefined
    }
    // Self-contained (its own Models -> Framebuffers -> Textures -> UniformStores
    // -> Buffers); after the Models above, which bind its texture.
    this.dataBounds?.destroy()
    this.dataBounds = undefined

    // 4. Destroy UniformStores (Models already destroyed their managed uniform buffers)
    this.calculateLevelsUniformStore?.destroy()
    this.calculateLevelsUniformStore = undefined
    this.forceLevelUniformStore?.destroy()
    this.forceLevelUniformStore = undefined
    this.buildNearFieldSlotsUniformStore?.destroy()
    this.buildNearFieldSlotsUniformStore = undefined
    this.forceNearFieldUniformStore?.destroy()
    this.forceNearFieldUniformStore = undefined
    this.forceAllPairsUniformStore?.destroy()
    this.forceAllPairsUniformStore = undefined
    this.occupancyUniformStore?.destroy()
    this.occupancyUniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models, must destroy manually)
    if (this.pointIndices && !this.pointIndices.destroyed) {
      this.pointIndices.destroy()
    }
    this.pointIndices = undefined
    if (this.forceVertexCoordBuffer && !this.forceVertexCoordBuffer.destroyed) {
      this.forceVertexCoordBuffer.destroy()
    }
    this.forceVertexCoordBuffer = undefined
  }

  /**
   * Starts the non-blocking copy of a reduction the step drew, behind a fence. Called
   * after every pass of the frame is queued, so the copy and its fence
   * close the queue. Nothing to do without a reduction waiting, or without WebGL.
   * @internal
   */
  public issueOccupancy (): void {
    if (!this.isOccupancyIssueWanted || this.occupancyReadback?.inFlight) return
    this.isOccupancyIssueWanted = false
    if (!this.occupancyTarget || this.occupancyTarget.fbo.destroyed) return
    const gl = (this.device as unknown as { gl?: WebGL2RenderingContext }).gl
    const handle = (this.occupancyTarget.fbo as unknown as { handle?: WebGLFramebuffer }).handle
    if (!gl || !handle) return
    this.occupancyReadback ||= new PickingReadback(gl, OCCUPANCY_BLOCKS * OCCUPANCY_BLOCKS * 4)
    this.occupancyReadback.issue(handle, 0, 0, OCCUPANCY_BLOCKS, OCCUPANCY_BLOCKS)
  }

  /**
   * Collects a finished occupancy read, if one has finished, and turns it into
   * the automatic slot count: the smallest power of two that leaves at most
   * OCCUPANCY_MISS of the points in finest cells fuller than it. The
   * first measurement applies at once; later ones take two in a row that agree.
   * The result is only a want — nearFieldSlotCount caps it by the size budget.
   * From `heldMs`, how long `Graph` held this frame while an occupancy copy was in flight,
   * sets the earliest time of the next measurement (occupancyNotBefore): the whole hold,
   * also when another copy was pending too, the safe side. A hold for other copies alone
   * reaches it as 0 and costs the measurement nothing.
   * Called before a frame queues any pass: `getBufferSubData`
   * waits for every command queued before it, fence or no fence. @internal
   */
  public collectOccupancy (heldMs = 0): void {
    const blocks = this.occupancyReadback?.poll()
    // A hold is charged whether the copy landed or the hold's cap dropped it
    // (READBACK_WAIT_CAP_MS): a fence that never signals cannot freeze a frame every
    // OCCUPANCY_INTERVAL steps
    if (blocks || heldMs > 0) this.occupancyNotBefore = performance.now() + heldMs / OCCUPANCY_HOLD_SHARE
    if (!blocks) return
    // [points, points in cells of more than 8, more than 16, more than 32] per block
    let points = 0
    const overflow = [0, 0, 0]
    for (let i = 0; i < OCCUPANCY_BLOCKS * OCCUPANCY_BLOCKS; i += 1) {
      points += blocks[i * 4]!
      for (let k = 0; k < overflow.length; k += 1) overflow[k] = overflow[k]! + blocks[i * 4 + 1 + k]!
    }
    // An empty level, or a read that came back without numbers, says nothing about the layout
    if (!(points > 0) || !overflow.every(Number.isFinite)) return
    const wanted = getWantedSlotCount(points, overflow)
    if (this.autoSlotCount === undefined || wanted === this.proposedSlotCount) {
      this.autoSlotCount = wanted
      this.proposedSlotCount = undefined
    } else if (wanted !== this.autoSlotCount) {
      this.proposedSlotCount = wanted
    } else {
      this.proposedSlotCount = undefined
    }
  }

  /** Drops the occupancy copy in flight; the next measurement takes its place. @internal */
  public cancelOccupancyReadback (): void {
    this.occupancyReadback?.cancel()
  }

  /**
   * Forgets everything measured, for a layout the measurements may no longer describe:
   * a changed point count, or a changed `simulationRepulsionSamples` (while a count is
   * configured the layout moves on unmeasured, and no measurement is taken). The automatic
   * count falls back to its size tier and measures on the next step the hold budget allows,
   * which a restart keeps (occupancyNotBefore). @internal
   */
  public restartOccupancyMeasurement (): void {
    this.occupancyReadback?.cancel()
    this.isOccupancyIssueWanted = false
    this.occupancyTick = 0
    this.lastOccupancyTick = undefined
    this.proposedSlotCount = undefined
    this.autoSlotCount = undefined
  }

  /**
   * While the slot count is automatic: on the first step and once OCCUPANCY_INTERVAL
   * steps have passed since the last and the hold budget allows (occupancyNotBefore),
   * reduces the finest level just aggregated into block statistics, for
   * `issueOccupancy()` to copy once the step's passes are queued. Put off to a later step
   * while a read is in flight, and skipped where the size affords only MIN_AUTO_SLOTS,
   * which no measurement can change.
   *
   * Only a step in a held frame measures (SimulationStepOptions.held): a frame of
   * `Graph`'s render loop on the graph's own device, which holds its next frame
   * until the copy lands, so no frame of the graph or work of a host sharing the
   * device is queued ahead of the collect — only the uploads of a data apply made
   * between the frames, which keeps the reading in flight (create()). A host that drives the steps or
   * frames itself keeps submitting work behind the copy, and `getBufferSubData`
   * waits for everything queued before it, several frames on a GPU-bound loop.
   * Any step or frame outside a held frame drops a reading in flight
   * (GraphSimulation.runSimulationStep, Graph.drawFrame).
   */
  private measureOccupancy (levelTexture: Texture, gridSize: number, isHeld: boolean): void {
    const { device } = this
    if (!this.usesAutoSlotCount || !isHeld) return
    if (getAffordableSlotCount(this.data.pointsNumber ?? 0) <= MIN_AUTO_SLOTS) return
    const tick = this.occupancyTick
    this.occupancyTick += 1
    if (this.lastOccupancyTick !== undefined && tick - this.lastOccupancyTick < OCCUPANCY_INTERVAL) return
    if (performance.now() < this.occupancyNotBefore) return
    if (!this.occupancyCommand || !this.occupancyUniformStore) return
    if (!this.occupancyTarget || this.occupancyTarget.fbo.destroyed || levelTexture.destroyed) return
    if (this.occupancyReadback?.inFlight) return

    const blockSize = Math.ceil(gridSize / OCCUPANCY_BLOCKS)
    this.occupancyUniformStore.setUniforms({
      occupancyUniforms: {
        levelTextureWidth: gridSize,
        levelTextureHeight: gridSize,
        blockWidth: blockSize,
        blockHeight: blockSize,
      },
    })
    this.occupancyCommand.setBindings({ levelTexture })
    const pass = device.beginRenderPass({
      framebuffer: this.occupancyTarget.fbo,
      clearColor: [0, 0, 0, 0],
    })
    this.occupancyCommand.draw(pass)
    pass.end()
    this.lastOccupancyTick = tick
    this.isOccupancyIssueWanted = true
  }

  /**
   * The small-graph path: a single exact all-pairs pass into the velocity FBO.
   * Replaces the pyramid + near-field passes below ALL_PAIRS_MAX_POINTS.
   */
  private drawAllPairsForce (): void {
    const { device, store, data, points } = this
    if (!points) return
    if (!this.forceAllPairsCommand || !this.forceAllPairsUniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!this.randomValuesTexture || this.randomValuesTexture.destroyed) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return
    if (!data.pointsNumber) return

    this.forceAllPairsUniformStore.setUniforms({
      forceAllPairsUniforms: {
        pointsTextureSize: store.pointsTextureSize ?? 0,
        pointsNumber: data.pointsNumber,
        alpha: store.alpha,
        repulsion: this.config.simulationRepulsion,
        // The grid path's near-field bound at this point count (getMaxStep),
        // also the shader's near/far split radius.
        maxStep: getMaxStep(store.kickSpan, data.pointsNumber),
      },
    })

    this.forceAllPairsCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      randomValues: this.randomValuesTexture,
      exitTexture: points.exitTexture,
    })

    const drawPass = device.beginRenderPass({
      framebuffer: points.velocityFbo,
      clearColor: [0, 0, 0, 0],
    })
    this.forceAllPairsCommand.draw(drawPass)
    drawPass.end()
  }

  /**
   * Recomputes this tick's data bounds from the positions the passes below
   * bin, floored so the finest cell is at least MIN_FINEST_CELL_SIZE, and
   * places the grid over them at a fresh random offset (see the class doc).
   */
  private drawBounds (): void {
    const { store, data, points } = this
    if (!points || !this.dataBounds) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!data.pointsNumber || !store.pointsTextureSize) return

    this.dataBounds.run({
      positionsTexture: points.previousPositionTexture,
      exitTexture: points.exitTexture,
      pointsTextureSize: store.pointsTextureSize,
      pointsNumber: data.pointsNumber,
      minExtent: getFinestGridSize(data.pointsNumber) * MIN_FINEST_CELL_SIZE,
      // A fresh uniform shift every tick, from the simulation's random stream
      // (seeded by randomSeed when set)
      originShift: {
        cellsPerAxis: COARSEST_GRID_SIZE,
        offset: [store.getRandomFloat(0, 1), store.getRandomFloat(0, 1)],
      },
    })
  }

  /** Aggregates points into every grid level texture. */
  private drawLevels (): void {
    const { device, data, points } = this
    if (!points) return
    if (!this.calculateLevelsCommand || !this.calculateLevelsUniformStore) return
    const dataBoundsTexture = this.dataBounds?.texture
    if (!dataBoundsTexture) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!data.pointsNumber) return
    // Ensure pointIndices is set (Model might exist but attributes not set yet)
    if (!this.pointIndices) return

    for (let level = 0; level < this.levels; level += 1) {
      const target = this.levelTargets.get(level)
      if (!target || target.fbo.destroyed || target.texture.destroyed) continue

      this.calculateLevelsUniformStore.setUniforms({
        calculateLevelsPreciseUniforms: {
          levelGridSize: target.gridSize,
        },
      })

      // Unused points-texture pixels must not aggregate phantom mass into cell (0,0)
      this.calculateLevelsCommand.setVertexCount(data.pointsNumber)
      // Update texture bindings dynamically
      this.calculateLevelsCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        exitTexture: points.exitTexture,
        dataBoundsTexture,
      })

      const levelPass = device.beginRenderPass({
        framebuffer: target.fbo,
        clearColor: [0, 0, 0, 0],
      })
      this.calculateLevelsCommand.draw(levelPass)
      levelPass.end()
    }
  }

  /**
   * Rebuilds the near-field point slots for this tick: one depth-peeling pass
   * per slot over the points, each capturing the eligible point with
   * the smallest per-tick random hash per finest-level cell (see
   * build-nearfield-slots.vert). Re-seeded every tick so dense cells rotate all
   * their points through exact pairwise treatment. Pass k renders into its own
   * layer and samples pass k−1's from the other array (see NearFieldSlots).
   */
  private drawNearFieldSlots (): void {
    const { device, store, data, points, nearField } = this
    if (!points) return
    if (!this.buildNearFieldSlotsCommand || !this.buildNearFieldSlotsUniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!data.pointsNumber || !this.pointIndices) return
    if (!nearField || nearField.arrays.some(array => array.destroyed)) return
    const finest = this.levelTargets.get(this.levels - 1)
    if (!finest || finest.texture.destroyed) return
    const dataBoundsTexture = this.dataBounds?.texture
    if (!dataBoundsTexture) return

    const randomSeed = store.getRandomFloat(0, 1)

    for (let slot = 0; slot < nearField.count; slot += 1) {
      const fbo = nearField.fbos[slot]
      const previous = nearField.arrays[(slot + 1) % SLOT_ARRAYS]
      if (!fbo || fbo.destroyed || !previous) continue

      this.buildNearFieldSlotsUniformStore.setUniforms({
        buildNearFieldSlotsUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          levelGridSize: finest.gridSize,
          hasPreviousSlot: slot === 0 ? 0 : 1,
          // The seed is shared by all slots of one tick — peeling relies on a
          // consistent hash ordering across the passes.
          randomSeed,
          previousLayer: Math.max(0, slot - 1) >> 1,
        },
      })

      this.buildNearFieldSlotsCommand.setVertexCount(data.pointsNumber)
      this.buildNearFieldSlotsCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        exitTexture: points.exitTexture,
        // Pass 0 never samples previousSlot, but the binding must exist for the
        // draw to run; the other array is never pass 0's render target.
        previousSlot: previous,
        dataBoundsTexture,
      })

      const slotPass = device.beginRenderPass({
        framebuffer: fbo,
        // Cleared slot = empty: index -1 with hash 1 keeps later passes ineligible
        clearColor: [-1, 1, 0, 0],
        clearDepth: 1,
      })
      this.buildNearFieldSlotsCommand.draw(slotPass)
      slotPass.end()
    }
  }

  /**
   * One additive pass per grid level into the velocity FBO, then the near-field
   * pass reading the finest level to close its 3×3 neighborhood.
   */
  private drawForces (): void {
    const { device, store, data, points, nearField } = this
    if (!points) return
    if (!this.forceLevelCommand || !this.forceLevelUniformStore) return
    if (!this.forceNearFieldCommand || !this.forceNearFieldUniformStore) return
    if (!nearField || nearField.arrays.some(array => array.destroyed)) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!this.randomValuesTexture || this.randomValuesTexture.destroyed) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return
    const dataBoundsTexture = this.dataBounds?.texture
    if (!dataBoundsTexture) return

    const drawPass = device.beginRenderPass({
      framebuffer: points.velocityFbo,
      clearColor: [0, 0, 0, 0],
    })

    const precise = this.preciseFarField
    for (let level = 0; level < this.levels; level += 1) {
      const target = this.levelTargets.get(level)
      if (!target || target.texture.destroyed) continue

      this.forceLevelUniformStore.setUniforms({
        forceLevelPreciseUniforms: {
          levelGridSize: target.gridSize,
          isFirstLevel: level === 0 ? 1 : 0,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
          shellRadius: getShellRadius(level, this.levels, precise),
          parentShellRadius: level === 0 ? 0 : getShellRadius(level - 1, this.levels, precise),
        },
      })

      // Update texture bindings dynamically
      this.forceLevelCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        levelTexture: target.texture,
        dataBoundsTexture,
      })
      this.forceLevelCommand.draw(drawPass)

      // The finest level leaves only the 3×3 neighborhood uncovered — the near-field
      // pass closes it with importance-weighted pairwise forces from the
      // depth-peeled slot points (unbiased Monte-Carlo of the all-pairs sum).
      if (level === this.levels - 1) {
        this.forceNearFieldUniformStore.setUniforms({
          forceNearFieldUniforms: {
            pointsTextureSize: store.pointsTextureSize ?? 0,
            levelGridSize: target.gridSize,
            maxStep: getMaxStep(store.kickSpan, data.pointsNumber ?? 0),
            alpha: store.alpha,
            repulsion: this.config.simulationRepulsion,
            slotCount: nearField.count,
          },
        })

        this.forceNearFieldCommand.setBindings({
          positionsTexture: points.previousPositionTexture,
          levelTexture: target.texture,
          randomValues: this.randomValuesTexture,
          slotsEven: nearField.arrays[0]!,
          slotsOdd: nearField.arrays[1]!,
          dataBoundsTexture,
        })
        this.forceNearFieldCommand.draw(drawPass)
      }
    }

    drawPass.end()
  }

  /**
   * Allocates the grid level pyramid: grids of 8², 16², … up to an adaptive
   * finest resolution (~2·√n cells per axis, floored at 8² and capped at
   * MAX_GRID_SIZE). Textures are not zero-filled here — drawLevels clears them
   * every tick.
   */
  private createLevels (): void {
    const { device } = this
    const pointsNumber = this.data.pointsNumber ?? 0

    const finestGridSize = getFinestGridSize(pointsNumber)
    this.levels = Math.log2(finestGridSize / COARSEST_GRID_SIZE) + 1

    for (let level = 0; level < this.levels; level += 1) {
      // A level's size only depends on its index (level L is always a
      // COARSEST_GRID_SIZE·2^L grid), so any level we already built is guaranteed to still be the right
      // size. That's why we can just skip the ones we have and build only what's
      // missing — on the first run, or the finer levels we need again after the
      // pyramid grew back. (Shrinking is handled by the drop loop below.) The
      // near-field slots are the opposite case — they really can change size, see
      // createNearFieldSlots.
      if (this.levelTargets.has(level)) continue

      const gridSize = COARSEST_GRID_SIZE * Math.pow(2, level)
      const texture = device.createTexture({
        width: gridSize,
        height: gridSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER,
      })
      const fbo = device.createFramebuffer({
        width: gridSize,
        height: gridSize,
        colorAttachments: [texture],
      })
      this.levelTargets.set(level, { texture, fbo, gridSize })
    }

    // Drop stale finer levels if the pyramid shrank
    for (const [level, target] of Array.from(this.levelTargets.entries())) {
      if (level >= this.levels) {
        if (!target.fbo.destroyed) target.fbo.destroy()
        if (!target.texture.destroyed) target.texture.destroy()
        this.levelTargets.delete(level)
      }
    }

    // Near-field slot textures share the finest level's grid layout
    const finest = this.levelTargets.get(this.levels - 1)
    if (finest) this.createNearFieldSlots(finest)
  }

  /**
   * Allocates the near-field slots (NearFieldSlots): the two slot arrays, the
   * depth attachment the peel's smallest-hash selection runs on, and one
   * framebuffer per slot attaching its layer.
   */
  private createNearFieldSlots (finest: LevelTarget): void {
    const { device } = this
    const count = this.nearFieldSlotCount
    // These targets follow the finest level's grid, and that grid does change
    // size as the graph grows or shrinks (it snaps to powers of two) — and the
    // slot count changes with the point count too. If everything we already
    // have matches, keep it; otherwise throw it away and rebuild.
    const existing = this.nearField
    if (
      existing &&
      existing.gridSize === finest.gridSize &&
      existing.count === count &&
      existing.fbos.every(fbo => !fbo.destroyed) &&
      existing.arrays.every(array => !array.destroyed) &&
      !existing.depth.destroyed
    ) return

    this.destroyNearFieldSlots()
    const layers = Math.ceil(count / SLOT_ARRAYS)
    const arrays: Texture[] = []
    for (let array = 0; array < SLOT_ARRAYS; array += 1) {
      arrays.push(device.createTexture({
        dimension: '2d-array',
        width: finest.gridSize,
        height: finest.gridSize,
        depth: layers,
        format: 'rg32float',
        usage: Texture.SAMPLE | Texture.RENDER,
      }))
    }
    // Depth resolution must cover the 24-bit peel hash: the depth test picks
    // each slot's winner, but the next pass's eligibility compares the full
    // hash from the color target. A 16-bit depth buffer quantizes ties into
    // existence, and a tie resolved by draw order can exclude the true
    // smallest-hash point from the whole tick's sample.
    const depth = device.createTexture({
      width: finest.gridSize,
      height: finest.gridSize,
      format: 'depth24plus',
      usage: Texture.RENDER,
    })
    const views: TextureView[] = []
    const fbos: Framebuffer[] = []
    for (let slot = 0; slot < count; slot += 1) {
      const view = arrays[slot % SLOT_ARRAYS]!.createView({ dimension: '2d', baseArrayLayer: slot >> 1, arrayLayerCount: 1, mipLevelCount: 1 })
      views.push(view)
      fbos.push(device.createFramebuffer({
        width: finest.gridSize,
        height: finest.gridSize,
        colorAttachments: [view],
        depthStencilAttachment: depth,
      }))
    }
    this.nearField = { count, gridSize: finest.gridSize, arrays, depth, views, fbos }
  }

  private destroyNearFieldSlots (): void {
    const { nearField } = this
    if (!nearField) return
    for (const fbo of nearField.fbos) {
      if (!fbo.destroyed) fbo.destroy()
    }
    for (const view of nearField.views) {
      if (!view.destroyed) view.destroy()
    }
    for (const array of nearField.arrays) {
      if (!array.destroyed) array.destroy()
    }
    if (!nearField.depth.destroyed) nearField.depth.destroy()
    this.nearField = undefined
  }

  private destroyLevelTargets (): void {
    for (const target of this.levelTargets.values()) {
      if (!target.fbo.destroyed) target.fbo.destroy()
      if (!target.texture.destroyed) target.texture.destroy()
    }
    this.levelTargets.clear()
    this.destroyNearFieldSlots()
  }
}
