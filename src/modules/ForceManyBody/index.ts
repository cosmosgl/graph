import { Buffer, Framebuffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'

import calculateLevelFrag from '@/graph/modules/ForceManyBody/calculate-level.frag?raw'
import calculateLevelPreciseVert from '@/graph/modules/ForceManyBody/calculate-level.vert?raw'
import forceLevelPreciseFrag from '@/graph/modules/ForceManyBody/force-level.frag?raw'
import forceNearFieldFrag from '@/graph/modules/ForceManyBody/force-nearfield.frag?raw'
import forceAllPairsFrag from '@/graph/modules/ForceManyBody/force-allpairs.frag?raw'
import buildNearFieldSlotsVert from '@/graph/modules/ForceManyBody/build-nearfield-slots.vert?raw'
import buildNearFieldSlotsFrag from '@/graph/modules/ForceManyBody/build-nearfield-slots.frag?raw'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

/**
 * Finest grid resolution per axis. Also bounds the near-field slot textures,
 * which share the finest level's layout.
 */
const MAX_GRID_SIZE = 512

/**
 * Finest grid resolution per axis for a point count: ~2·√n, floored at 8²,
 * capped at MAX_GRID_SIZE. Shared by the pyramid allocation and the all-pairs
 * pass's per-tick velocity clamp, which must bound with the same cell size the
 * grid path would use at the same count.
 */
const getFinestGridSize = (pointsNumber: number): number =>
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
 * Graphs at or below ALL_PAIRS_MAX_POINTS never reach this path at all — they
 * take the exact all-pairs pass instead, so the tiers start above it.
 */
const getNearFieldSlotCount = (pointsNumber: number): number => {
  if (pointsNumber <= 16384) return 32
  if (pointsNumber <= 65536) return 16
  return 8
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

/** A near-field depth-peeling render target ([point index, hash] per cell). */
type SlotTarget = {
  texture: Texture;
  fbo: Framebuffer;
}

/** Ping-pong pair: each peel pass writes one and reads the other. */
const PEEL_TARGETS = 2

/**
 * GPU many-body (repulsion) force.
 *
 * Graphs at or below ALL_PAIRS_MAX_POINTS are computed exactly in a single
 * all-pairs pass (see that constant for why). Above it:
 *
 * A Barnes-Hut-style grid pyramid (each level covers its aligned 6×6 child block
 * minus the Chebyshev-1 shell) whose finest 3×3 neighborhood is closed by an
 * unbiased Monte-Carlo near field: a per-tick depth-peeled random subset of each
 * cell's points, Horvitz–Thompson-weighted so the expected force equals the exact
 * all-pairs sum. Close points therefore repel each other individually instead of
 * through a cell centroid, which keeps dense hubs from collapsing into disks and
 * petals. Small/sparse graphs land at most one point per cell, so the near field
 * samples each cell exhaustively and the far cells' centroids are exact — the
 * approximation only kicks in once cells hold more points than sampling slots.
 */
export class ForceManyBody extends CoreModule {
  private randomValuesTexture: Texture | undefined
  private pointIndices: Buffer | undefined
  /** Grid level count; `0` until create() allocates the pyramid. */
  private levels = 0
  private levelTargets = new Map<number, LevelTarget>()
  /** Near-field slot count for the current point count (getNearFieldSlotCount). */
  private nearFieldSlots = 0
  /**
   * Near-field point slots: one sampler2DArray layer per depth-peeling pass,
   * sharing the finest level's grid layout, each holding [point index, hash]
   * per cell — rebuilt every tick (see build-nearfield-slots.vert).
   */
  private slotsArrayTexture: Texture | undefined
  /**
   * The two ping-pong peel render targets: pass k draws into k % 2 while
   * reading the previous pass's result from (k + 1) % 2, then the result is
   * copied into layer k of slotsArrayTexture. Peeling can't render into the
   * array layers directly — pass k needs to sample pass k−1's output, and
   * sampling one layer of a texture while rendering to another is a WebGL
   * feedback loop.
   */
  private peelTargets: SlotTarget[] = []

  private calculateLevelsCommand: Model | undefined
  private forceLevelCommand: Model | undefined
  private buildNearFieldSlotsCommand: Model | undefined
  private forceNearFieldCommand: Model | undefined
  private forceAllPairsCommand: Model | undefined

  private forceVertexCoordBuffer: Buffer | undefined

  private calculateLevelsUniformStore: UniformStore<{
    calculateLevelsPreciseUniforms: {
      levelGridSize: number;
      cellSize: number;
    };
  }> | undefined

  private forceLevelUniformStore: UniformStore<{
    forceLevelPreciseUniforms: {
      levelGridSize: number;
      cellSize: number;
      isFirstLevel: number;
      alpha: number;
      repulsion: number;
    };
  }> | undefined

  private buildNearFieldSlotsUniformStore: UniformStore<{
    buildNearFieldSlotsUniforms: {
      pointsTextureSize: number;
      levelGridSize: number;
      cellSize: number;
      hasPreviousSlot: number;
      randomSeed: number;
    };
  }> | undefined

  private forceNearFieldUniformStore: UniformStore<{
    forceNearFieldUniforms: {
      pointsTextureSize: number;
      levelGridSize: number;
      cellSize: number;
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

  /** Small graphs skip the grid + Monte-Carlo machinery entirely (see ALL_PAIRS_MAX_POINTS). */
  private get usesAllPairs (): boolean {
    return (this.data.pointsNumber ?? 0) <= ALL_PAIRS_MAX_POINTS
  }

  public create (): void {
    const { device, store } = this
    if (!store.pointsTextureSize) return

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

    // Grid aggregation command (point list, additive blend)
    this.calculateLevelsUniformStore ||= new UniformStore(device, {
      calculateLevelsPreciseUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          levelGridSize: 'f32',
          cellSize: 'f32',
        },
        defaultUniforms: {
          levelGridSize: 0,
          cellSize: 0,
        },
      },
    })

    this.calculateLevelsCommand ||= new Model(device, {
      fs: calculateLevelFrag,
      vs: calculateLevelPreciseVert,
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
          cellSize: 'f32',
          isFirstLevel: 'f32',
          alpha: 'f32',
          repulsion: 'f32',
        },
        defaultUniforms: {
          levelGridSize: 0,
          cellSize: 0,
          isFirstLevel: 0,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
        },
      },
    })

    this.forceLevelCommand ||= new Model(device, {
      fs: forceLevelPreciseFrag,
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
          cellSize: 'f32',
          hasPreviousSlot: 'f32',
          randomSeed: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize,
          levelGridSize: 0,
          cellSize: 0,
          hasPreviousSlot: 0,
          randomSeed: 0,
        },
      },
    })

    this.buildNearFieldSlotsCommand ||= new Model(device, {
      fs: buildNearFieldSlotsFrag,
      vs: buildNearFieldSlotsVert,
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
          cellSize: 'f32',
          alpha: 'f32',
          repulsion: 'f32',
          slotCount: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize,
          levelGridSize: 0,
          cellSize: 0,
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
      parameters: {
        blend: false,
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })

    this.forceNearFieldCommand ||= new Model(device, {
      fs: forceNearFieldFrag,
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

  public run (): void {
    // Skip if point topology changed and create() wasn't called yet. Space size
    // is intentionally not guarded: grid allocation is point-count-based and
    // every draw computes cellSize from the live adjustedSpaceSize.
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

    // Nothing to do until the grid pyramid and near-field slots are allocated
    // (create() builds them; this guards a partial/failed allocation).
    if (this.levelTargets.size === 0 || this.peelTargets.length !== PEEL_TARGETS || !this.slotsArrayTexture) return

    this.drawLevels()
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

    // 2. Destroy Framebuffers + 3. Textures (grid targets destroy their FBOs
    // before their textures internally)
    if (this.randomValuesTexture && !this.randomValuesTexture.destroyed) {
      this.randomValuesTexture.destroy()
    }
    this.randomValuesTexture = undefined
    this.destroyLevelTargets()

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
        // The near-field pass's per-tick bound and the shader's near/far split
        // radius, computed from the finest cell size the grid path would use
        // at this point count.
        maxStep: 2 * (store.adjustedSpaceSize / getFinestGridSize(data.pointsNumber)),
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

  /** Aggregates points into every grid level texture. */
  private drawLevels (): void {
    const { device, store, data, points } = this
    if (!points) return
    if (!this.calculateLevelsCommand || !this.calculateLevelsUniformStore) return
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
          // Computed per level from the space size so the power-of-two halving
          // chain stays bit-exact between levels (the coverage invariant relies on it).
          cellSize: store.adjustedSpaceSize / target.gridSize,
        },
      })

      // Unused points-texture pixels must not aggregate phantom mass into cell (0,0)
      this.calculateLevelsCommand.setVertexCount(data.pointsNumber)
      // Update texture bindings dynamically
      this.calculateLevelsCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        exitTexture: points.exitTexture,
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
   * Rebuilds the near-field point slots for this tick: `nearFieldSlots`
   * depth-peeling passes over the points, each capturing the eligible point with
   * the smallest per-tick random hash per finest-level cell (see
   * build-nearfield-slots.vert). Re-seeded every tick so dense cells rotate all
   * their points through exact pairwise treatment. Each pass ping-pongs between
   * the two peel targets (reading the previous pass's output), then its result
   * is copied into its layer of the slot array texture.
   */
  private drawNearFieldSlots (): void {
    const { device, store, data, points } = this
    if (!points) return
    if (!this.buildNearFieldSlotsCommand || !this.buildNearFieldSlotsUniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!data.pointsNumber || !this.pointIndices) return
    if (!this.slotsArrayTexture || this.slotsArrayTexture.destroyed) return
    const finest = this.levelTargets.get(this.levels - 1)
    if (!finest || finest.texture.destroyed) return

    const randomSeed = store.getRandomFloat(0, 1)

    for (let slot = 0; slot < this.nearFieldSlots; slot += 1) {
      const target = this.peelTargets[slot % PEEL_TARGETS]
      const previous = this.peelTargets[(slot + 1) % PEEL_TARGETS]
      if (!target || target.fbo.destroyed || !previous || previous.texture.destroyed) continue

      this.buildNearFieldSlotsUniformStore.setUniforms({
        buildNearFieldSlotsUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          levelGridSize: finest.gridSize,
          cellSize: store.adjustedSpaceSize / finest.gridSize,
          hasPreviousSlot: slot === 0 ? 0 : 1,
          // The seed is shared by all slots of one tick — peeling relies on a
          // consistent hash ordering across the passes.
          randomSeed,
        },
      })

      this.buildNearFieldSlotsCommand.setVertexCount(data.pointsNumber)
      this.buildNearFieldSlotsCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        exitTexture: points.exitTexture,
        // Pass 0 never samples previousSlot, but the binding must exist for the
        // draw to run — any texture that is not the render target works.
        previousSlot: slot === 0
          ? points.previousPositionTexture
          : previous.texture,
      })

      const slotPass = device.beginRenderPass({
        framebuffer: target.fbo,
        // Cleared slot = empty: index -1 with hash 1 keeps later passes ineligible
        clearColor: [-1, 1, 0, 0],
        clearDepth: 1,
      })
      this.buildNearFieldSlotsCommand.draw(slotPass)
      slotPass.end()

      // Publish this pass's result as layer `slot` of the array texture that
      // the near-field force pass samples.
      const commandEncoder = device.createCommandEncoder()
      commandEncoder.copyTextureToTexture({
        sourceTexture: target.texture,
        destinationTexture: this.slotsArrayTexture,
        destinationOrigin: [0, 0, slot],
        width: finest.gridSize,
        height: finest.gridSize,
      })
      // finish() destroys the encoder itself and returns the command buffer.
      device.submit(commandEncoder.finish())
    }
  }

  /**
   * One additive pass per grid level into the velocity FBO, then the near-field
   * pass reading the finest level to close its 3×3 neighborhood.
   */
  private drawForces (): void {
    const { device, store, points } = this
    if (!points) return
    if (!this.forceLevelCommand || !this.forceLevelUniformStore) return
    if (!this.forceNearFieldCommand || !this.forceNearFieldUniformStore) return
    if (this.peelTargets.length !== PEEL_TARGETS) return
    if (!this.slotsArrayTexture || this.slotsArrayTexture.destroyed) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!this.randomValuesTexture || this.randomValuesTexture.destroyed) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return

    const drawPass = device.beginRenderPass({
      framebuffer: points.velocityFbo,
      clearColor: [0, 0, 0, 0],
    })

    for (let level = 0; level < this.levels; level += 1) {
      const target = this.levelTargets.get(level)
      if (!target || target.texture.destroyed) continue
      const cellSize = store.adjustedSpaceSize / target.gridSize

      this.forceLevelUniformStore.setUniforms({
        forceLevelPreciseUniforms: {
          levelGridSize: target.gridSize,
          cellSize,
          isFirstLevel: level === 0 ? 1 : 0,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
        },
      })

      // Update texture bindings dynamically
      this.forceLevelCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        levelTexture: target.texture,
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
            cellSize,
            alpha: store.alpha,
            repulsion: this.config.simulationRepulsion,
            slotCount: this.nearFieldSlots,
          },
        })

        this.forceNearFieldCommand.setBindings({
          positionsTexture: points.previousPositionTexture,
          levelTexture: target.texture,
          randomValues: this.randomValuesTexture,
          slotsTexture: this.slotsArrayTexture,
        })
        this.forceNearFieldCommand.draw(drawPass)
      }
    }

    drawPass.end()
  }

  /**
   * Allocates the grid level pyramid: grids of 4², 8², … up to an adaptive
   * finest resolution (~2·√n cells per axis, floored at 8² and capped at
   * MAX_GRID_SIZE). Textures are not zero-filled here — drawLevels clears them
   * every tick.
   */
  private createLevels (): void {
    const { device } = this
    const pointsNumber = this.data.pointsNumber ?? 0

    const finestGridSize = getFinestGridSize(pointsNumber)
    this.levels = Math.log2(finestGridSize) - 1

    for (let level = 0; level < this.levels; level += 1) {
      // A level's size only depends on its index (level L is always a 2^(L+2)
      // grid), so any level we already built is guaranteed to still be the right
      // size. That's why we can just skip the ones we have and build only what's
      // missing — on the first run, or the finer levels we need again after the
      // pyramid grew back. (Shrinking is handled by the drop loop below.) The
      // near-field slots are the opposite case — they really can change size, see
      // createNearFieldSlotTargets.
      if (this.levelTargets.has(level)) continue

      const gridSize = Math.pow(2, level + 2)
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
    if (finest) this.createNearFieldSlotTargets(finest)
  }

  /**
   * Allocates the near-field sampling resources: the two ping-pong depth-peeling
   * targets ([point index, hash] per cell, with a depth attachment each for the
   * peel's smallest-hash selection) and the slot array texture (one layer per
   * peeling pass) that the force pass samples.
   */
  private createNearFieldSlotTargets (finest: LevelTarget): void {
    const { device } = this
    const slots = getNearFieldSlotCount(this.data.pointsNumber ?? 0)
    // These targets follow the finest level's grid, and that grid does change
    // size as the graph grows or shrinks (it snaps to powers of two) — and the
    // slot count changes with the point count too. If everything we already
    // have matches, keep it; otherwise throw it away and rebuild.
    const existing = this.peelTargets[0]
    if (
      existing &&
      !existing.texture.destroyed &&
      existing.texture.width === finest.gridSize &&
      existing.texture.height === finest.gridSize &&
      this.peelTargets.length === PEEL_TARGETS &&
      this.slotsArrayTexture &&
      !this.slotsArrayTexture.destroyed &&
      this.nearFieldSlots === slots
    ) return

    this.destroyNearFieldSlotTargets()
    this.nearFieldSlots = slots
    for (let target = 0; target < PEEL_TARGETS; target += 1) {
      const texture = device.createTexture({
        width: finest.gridSize,
        height: finest.gridSize,
        format: 'rg32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_SRC,
      })
      const fbo = device.createFramebuffer({
        width: finest.gridSize,
        height: finest.gridSize,
        colorAttachments: [texture],
        // Depth resolution must cover the 24-bit peel hash: the depth test picks
        // each slot's winner, but the next pass's eligibility compares the full
        // hash from the color target. A 16-bit depth buffer quantizes ties into
        // existence, and a tie resolved by draw order can exclude the true
        // smallest-hash point from the whole tick's sample.
        depthStencilAttachment: 'depth24plus',
      })
      this.peelTargets.push({ texture, fbo })
    }
    this.slotsArrayTexture = device.createTexture({
      dimension: '2d-array',
      width: finest.gridSize,
      height: finest.gridSize,
      depth: slots,
      format: 'rg32float',
      usage: Texture.SAMPLE | Texture.COPY_DST,
    })
  }

  private destroyNearFieldSlotTargets (): void {
    for (const target of this.peelTargets) {
      if (!target.fbo.destroyed) target.fbo.destroy()
      if (!target.texture.destroyed) target.texture.destroy()
    }
    this.peelTargets = []
    if (this.slotsArrayTexture && !this.slotsArrayTexture.destroyed) {
      this.slotsArrayTexture.destroy()
    }
    this.slotsArrayTexture = undefined
    this.nearFieldSlots = 0
  }

  private destroyLevelTargets (): void {
    for (const target of this.levelTargets.values()) {
      if (!target.fbo.destroyed) target.fbo.destroy()
      if (!target.texture.destroyed) target.texture.destroy()
    }
    this.levelTargets.clear()
    this.destroyNearFieldSlotTargets()
  }
}
