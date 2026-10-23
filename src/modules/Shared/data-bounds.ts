import { Buffer, Device, Framebuffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { BASE_PIPELINE_PARAMETERS } from '@/graph/modules/core-module'

import reduceBoundsBucketsFrag from '@/graph/modules/Shared/reduce-bounds-buckets.frag?raw'
import reduceBoundsBlocksFrag from '@/graph/modules/Shared/reduce-bounds-blocks.frag?raw'
import reduceBoundsFinalFrag from '@/graph/modules/Shared/reduce-bounds-final.frag?raw'
import quadVert from '@/graph/modules/Shared/quad.vert?raw'

/**
 * Partial boxes per axis each fragment of the middle pass folds, so no fragment
 * reads more than 64 of them. The last pass is a single fragment, and folding
 * all 4096 first-pass boxes there in sequence cost a fixed ~0.75 ms per tick on
 * an M3 Max, 11% of a 100k-point step. With the middle pass the whole reduction
 * takes ~0.16 ms up to 300k points.
 */
const BLOCK_SIZE = 8

/** First-pass partial boxes per axis for up to 64² · POINTS_PER_BUCKET points. */
const MIN_BUCKET_GRID_SIZE = 64

/** First-pass partial boxes per axis above that. */
const MAX_BUCKET_GRID_SIZE = 128

/**
 * Points each first-pass fragment should scan before the grid grows. Each one
 * walks its share of the point list in sequence, so the scan's length is what
 * grows with the graph: at 64² a million points is ~245 per fragment.
 */
const POINTS_PER_BUCKET = 64

/**
 * First-pass partial boxes per axis for a point count: 64² (→ 8² → 1) up to
 * 262,144 points, 128² (→ 16² → 1) above. A power of two that BLOCK_SIZE
 * divides, so the middle pass always folds whole blocks. Above the threshold
 * the first pass runs 4× the fragments, each scanning a quarter of the points,
 * and the last pass folds 256 partial boxes instead of 64.
 */
export const getBucketGridSize = (pointsNumber: number): number => Math.max(
  MIN_BUCKET_GRID_SIZE,
  Math.min(
    MAX_BUCKET_GRID_SIZE,
    2 ** Math.ceil(Math.log2(Math.sqrt(pointsNumber / POINTS_PER_BUCKET)))
  )
)

type Target = {
  texture: Texture;
  fbo: Framebuffer;
}

export type DataBoundsRunOptions = {
  /** Point positions, `.rg` = world position (one texel per point). */
  positionsTexture: Texture;
  /** Point exit state, `.g > 0.5` = absent (may be the 1×1 all-present stand-in). */
  exitTexture: Texture;
  pointsTextureSize: number;
  pointsNumber: number;
  /**
   * Smallest extent the box may report. A layout can legitimately have none —
   * one point, or every point stacked — and consumers divide the extent into
   * cells, so the caller passes the smallest box that still gives it usable cells.
   */
  minExtent: number;
  /**
   * Places the consumer's grid at an offset of the caller's choosing. After the
   * `minExtent` floor, the square is padded by one cell of the consumer's
   * coarsest grid, `extent / (cellsPerAxis - 1)` of the fitted side, and its
   * origin slides back by `offset` of that cell. The padding is exactly the
   * slide's range, so the fitted square stays inside whatever the offset.
   * Omitted, the box is the fitted, floored square.
   *
   * For a consumer whose result depends on which cell a point falls in: a cell
   * boundary that stays put becomes a line in the layout. A caller that draws a
   * fresh uniform offset every run spreads each level's boundaries evenly over
   * a whole coarsest cell, and with it over whole cells of every finer level.
   * DataBounds itself draws nothing; ForceManyBody does.
   */
  originShift?: {
    /** Cells per axis of the consumer's coarsest grid over the padded box. */
    cellsPerAxis: number;
    /** How far the origin slides back inside the padding cell, per axis, each in [0, 1). */
    offset: [number, number];
  };
}

/**
 * The bounding box of the live points, recomputed on the GPU and published as
 * one rgba32float texel: `[originX, originY, extent, 1 / extent]` — a square of
 * side `extent` with its minimum corner at the origin, fitted to the points and
 * floored at the caller's `minExtent`, then, with `originShift`, padded by one
 * coarsest cell and shifted by the caller's offset. The reciprocal is computed
 * once here so that every consumer scales by the same bits instead of dividing
 * on its own (grid-cell.ts).
 *
 * A spatial grid anchored to `[0, spaceSize]` gives a layout only the cells over
 * the part of the space it covers, and lumps points outside the space into its
 * edge cells. Anchoring the grid to this box instead makes its resolution a
 * property of the point set. The box never comes back to the CPU: a readback
 * would stall the pipeline every tick, so consumers read the texel in their
 * shaders.
 *
 * Absent points (`exit.g > 0.5`) and non-finite positions are left out: the
 * whole grid derives from this box, so one diverged point would otherwise set
 * the cell size for every other point. When nothing is left, the fitted square
 * degenerates to a `minExtent` square centred on (0, 0), which `originShift`
 * then pads and shifts like any other.
 */
export class DataBounds {
  private readonly device: Device
  private bucketsTarget: Target | undefined
  private blocksTarget: Target | undefined
  private boundsTarget: Target | undefined
  private bucketsCommand: Model | undefined
  private blocksCommand: Model | undefined
  private finalCommand: Model | undefined
  private vertexCoordBuffer: Buffer | undefined

  private bucketsUniformStore: UniformStore<{
    reduceBoundsBucketsUniforms: {
      pointsTextureSize: number;
      pointsNumber: number;
      bucketGridSize: number;
    };
  }> | undefined

  private blocksUniformStore: UniformStore<{
    reduceBoundsBlocksUniforms: {
      blockSize: number;
    };
  }> | undefined

  private finalUniformStore: UniformStore<{
    reduceBoundsFinalUniforms: {
      partialGridSize: number;
      minExtent: number;
      shiftCellsPerAxis: number;
      shiftOffsetX: number;
      shiftOffsetY: number;
    };
  }> | undefined

  public constructor (device: Device) {
    this.device = device
  }

  /** The published box texel; undefined until `run()` has produced one. */
  public get texture (): Texture | undefined {
    const texture = this.boundsTarget?.texture
    return texture && !texture.destroyed ? texture : undefined
  }

  /** Recomputes the box from the given positions. Every pass overwrites its target. */
  public run (options: DataBoundsRunOptions): void {
    const { device } = this
    const { positionsTexture, exitTexture, pointsTextureSize, pointsNumber, minExtent, originShift } = options
    if (!pointsNumber || !pointsTextureSize) return
    if (positionsTexture.destroyed || exitTexture.destroyed) return

    const bucketGridSize = getBucketGridSize(pointsNumber)
    const blockGridSize = bucketGridSize / BLOCK_SIZE
    this.ensureResources(bucketGridSize, blockGridSize)
    const buckets = this.bucketsTarget
    const blocks = this.blocksTarget
    const bounds = this.boundsTarget
    if (!buckets || buckets.fbo.destroyed || !blocks || blocks.fbo.destroyed || !bounds || bounds.fbo.destroyed) return
    if (!this.bucketsCommand || !this.bucketsUniformStore) return
    if (!this.blocksCommand || !this.blocksUniformStore) return
    if (!this.finalCommand || !this.finalUniformStore) return

    this.bucketsUniformStore.setUniforms({
      reduceBoundsBucketsUniforms: {
        pointsTextureSize,
        pointsNumber,
        bucketGridSize,
      },
    })
    this.bucketsCommand.setBindings({
      positionsTexture,
      exitTexture,
    })
    const bucketsPass = device.beginRenderPass({
      framebuffer: buckets.fbo,
      clearColor: [0, 0, 0, 0],
    })
    this.bucketsCommand.draw(bucketsPass)
    bucketsPass.end()

    this.blocksUniformStore.setUniforms({
      reduceBoundsBlocksUniforms: {
        blockSize: BLOCK_SIZE,
      },
    })
    this.blocksCommand.setBindings({
      partialsTexture: buckets.texture,
    })
    const blocksPass = device.beginRenderPass({
      framebuffer: blocks.fbo,
      clearColor: [0, 0, 0, 0],
    })
    this.blocksCommand.draw(blocksPass)
    blocksPass.end()

    this.finalUniformStore.setUniforms({
      reduceBoundsFinalUniforms: {
        partialGridSize: blockGridSize,
        minExtent,
        shiftCellsPerAxis: originShift?.cellsPerAxis ?? 0,
        shiftOffsetX: originShift?.offset[0] ?? 0,
        shiftOffsetY: originShift?.offset[1] ?? 0,
      },
    })
    this.finalCommand.setBindings({
      partialsTexture: blocks.texture,
    })
    const finalPass = device.beginRenderPass({
      framebuffer: bounds.fbo,
      clearColor: [0, 0, 0, 0],
    })
    this.finalCommand.draw(finalPass)
    finalPass.end()
  }

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   */
  public destroy (): void {
    this.bucketsCommand?.destroy()
    this.bucketsCommand = undefined
    this.blocksCommand?.destroy()
    this.blocksCommand = undefined
    this.finalCommand?.destroy()
    this.finalCommand = undefined

    for (const target of [this.bucketsTarget, this.blocksTarget, this.boundsTarget]) {
      if (!target) continue
      if (!target.fbo.destroyed) target.fbo.destroy()
      if (!target.texture.destroyed) target.texture.destroy()
    }
    this.bucketsTarget = undefined
    this.blocksTarget = undefined
    this.boundsTarget = undefined

    this.bucketsUniformStore?.destroy()
    this.bucketsUniformStore = undefined
    this.blocksUniformStore?.destroy()
    this.blocksUniformStore = undefined
    this.finalUniformStore?.destroy()
    this.finalUniformStore = undefined

    if (this.vertexCoordBuffer && !this.vertexCoordBuffer.destroyed) this.vertexCoordBuffer.destroy()
    this.vertexCoordBuffer = undefined
  }

  /**
   * Allocates the three passes on first use, and the first two targets at the
   * sizes this run needs — replacing them when the point count crosses the
   * bucket-grid threshold. The 1×1 box target never changes size, so its
   * texture is the same object for the instance's whole life.
   */
  private ensureResources (bucketGridSize: number, blockGridSize: number): void {
    const { device } = this

    this.bucketsTarget = this.ensureTarget(this.bucketsTarget, bucketGridSize)
    this.blocksTarget = this.ensureTarget(this.blocksTarget, blockGridSize)
    this.boundsTarget = this.ensureTarget(this.boundsTarget, 1)

    this.vertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    this.bucketsUniformStore ||= new UniformStore(device, {
      reduceBoundsBucketsUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
          pointsNumber: 'f32',
          bucketGridSize: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: 0,
          pointsNumber: 0,
          bucketGridSize: MIN_BUCKET_GRID_SIZE,
        },
      },
    })
    this.bucketsCommand ||= this.createPass(reduceBoundsBucketsFrag, {
      reduceBoundsBucketsUniforms: this.bucketsUniformStore.getManagedUniformBuffer('reduceBoundsBucketsUniforms'),
    })

    this.blocksUniformStore ||= new UniformStore(device, {
      reduceBoundsBlocksUniforms: {
        uniformTypes: {
          blockSize: 'f32',
        },
        defaultUniforms: {
          blockSize: BLOCK_SIZE,
        },
      },
    })
    this.blocksCommand ||= this.createPass(reduceBoundsBlocksFrag, {
      reduceBoundsBlocksUniforms: this.blocksUniformStore.getManagedUniformBuffer('reduceBoundsBlocksUniforms'),
    })

    this.finalUniformStore ||= new UniformStore(device, {
      reduceBoundsFinalUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          partialGridSize: 'f32',
          minExtent: 'f32',
          shiftCellsPerAxis: 'f32',
          shiftOffsetX: 'f32',
          shiftOffsetY: 'f32',
        },
        defaultUniforms: {
          partialGridSize: MIN_BUCKET_GRID_SIZE / BLOCK_SIZE,
          minExtent: 1,
          shiftCellsPerAxis: 0,
          shiftOffsetX: 0,
          shiftOffsetY: 0,
        },
      },
    })
    this.finalCommand ||= this.createPass(reduceBoundsFinalFrag, {
      reduceBoundsFinalUniforms: this.finalUniformStore.getManagedUniformBuffer('reduceBoundsFinalUniforms'),
    })
  }

  /** The given target if it is alive and `size` wide, else a new one — the old one destroyed. */
  private ensureTarget (target: Target | undefined, size: number): Target {
    if (target && !target.texture.destroyed && !target.fbo.destroyed && target.texture.width === size) return target
    if (target) {
      if (!target.fbo.destroyed) target.fbo.destroy()
      if (!target.texture.destroyed) target.texture.destroy()
    }
    return this.createTarget(size)
  }

  private createTarget (size: number): Target {
    const texture = this.device.createTexture({
      width: size,
      height: size,
      // Float: the box carries world coordinates.
      format: 'rgba32float',
      usage: Texture.SAMPLE | Texture.RENDER,
    })
    const fbo = this.device.createFramebuffer({
      width: size,
      height: size,
      colorAttachments: [texture],
    })
    return { texture, fbo }
  }

  /** A fullscreen pass with one fragment per target texel. */
  private createPass (fs: string, bindings: Record<string, Buffer>): Model {
    return new Model(this.device, {
      fs,
      vs: quadVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.vertexCoordBuffer as Buffer,
      },
      bufferLayout: [
        { name: 'vertexCoord', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings,
      // No blending: every pass overwrites its target wholesale. Blending in
      // the previous tick's box would let it only ever grow.
      parameters: BASE_PIPELINE_PARAMETERS,
    })
  }
}
