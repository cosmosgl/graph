import { Buffer, Device, Framebuffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { BASE_PIPELINE_PARAMETERS } from '@/graph/modules/core-module'

import reduceBoundsBucketsFrag from '@/graph/modules/Shared/reduce-bounds-buckets.frag?raw'
import reduceBoundsBlocksFrag from '@/graph/modules/Shared/reduce-bounds-blocks.frag?raw'
import reduceBoundsFinalFrag from '@/graph/modules/Shared/reduce-bounds-final.frag?raw'
import quadVert from '@/graph/modules/Shared/quad.vert?raw'

/**
 * Partial boxes per axis in the first reduction pass: 64² = 4096 fragments, so
 * even a million-point graph strides only ~245 points per fragment.
 */
const BUCKET_GRID_SIZE = 64

/**
 * Partial boxes per axis each fragment of the middle pass folds: 64² → 8² → 1,
 * so no fragment reads more than 64 of them. The last pass is a single
 * fragment, and folding all 4096 first-pass boxes there in sequence cost a
 * fixed ~0.75 ms per tick on an M3 Max, 11% of a 100k-point step. With the
 * middle pass the whole reduction takes ~0.16 ms up to 300k points.
 */
const BLOCK_SIZE = 8

/** Partial boxes per axis the middle pass leaves for the last one. */
const BLOCK_GRID_SIZE = BUCKET_GRID_SIZE / BLOCK_SIZE

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
}

/**
 * The bounding box of the live points, recomputed on the GPU and published as
 * one rgba32float texel: `[originX, originY, extent, 1 / extent]` — a square of
 * side `extent` with its minimum corner at the origin, fitted to the points and
 * floored at the caller's `minExtent`. The reciprocal is computed once here so
 * that every consumer scales by the same bits instead of dividing on its own
 * (grid-cell.ts).
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
 * the cell size for every other point. When nothing is left, the box degenerates
 * to a `minExtent` square centred on (0, 0).
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
    const { positionsTexture, exitTexture, pointsTextureSize, pointsNumber, minExtent } = options
    if (!pointsNumber || !pointsTextureSize) return
    if (positionsTexture.destroyed || exitTexture.destroyed) return

    this.ensureResources()
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
        bucketGridSize: BUCKET_GRID_SIZE,
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
        partialGridSize: BLOCK_GRID_SIZE,
        minExtent,
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

  /** Allocates the fixed-size targets and the three passes on first use. */
  private ensureResources (): void {
    const { device } = this

    if (!this.bucketsTarget || this.bucketsTarget.texture.destroyed) {
      this.bucketsTarget = this.createTarget(BUCKET_GRID_SIZE)
    }
    if (!this.blocksTarget || this.blocksTarget.texture.destroyed) {
      this.blocksTarget = this.createTarget(BLOCK_GRID_SIZE)
    }
    if (!this.boundsTarget || this.boundsTarget.texture.destroyed) {
      this.boundsTarget = this.createTarget(1)
    }

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
          bucketGridSize: BUCKET_GRID_SIZE,
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
        },
        defaultUniforms: {
          partialGridSize: BLOCK_GRID_SIZE,
          minExtent: 1,
        },
      },
    })
    this.finalCommand ||= this.createPass(reduceBoundsFinalFrag, {
      reduceBoundsFinalUniforms: this.finalUniformStore.getManagedUniformBuffer('reduceBoundsFinalUniforms'),
    })
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
