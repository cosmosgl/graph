import { Buffer, Framebuffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule, BASE_PIPELINE_PARAMETERS } from '@/graph/modules/core-module'

import buildGridVert from '@/graph/modules/ForceCollision/build-grid.vert?raw'
import buildGridFrag from '@/graph/modules/ForceCollision/build-grid.frag?raw'
import forceFrag from '@/graph/modules/ForceCollision/force-collision-spatial.frag?raw'
import { COLLISION_GRID_SIZE, collisionRotationSeed, withCollisionGrid } from '@/graph/modules/ForceCollision/collision-grid'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import { DataBounds } from '@/graph/modules/Shared/data-bounds'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'
import { defaultConfigValues } from '@/graph/variables'

type GridTarget = {
  texture: Texture;
  fbo: Framebuffer;
}

// Lattice shifts of the offset passes, in cells (improves collision detection at cell boundaries).
// The hash numbers its lattices x·2 + y·4 from these shifts (collision-grid.ts: COLLISION_ROTATIONS).
const GRID_OFFSETS: [number, number][] = [
  [0.0, 0.0],
  [0.5, 0.0],
  [0.0, 0.5],
  [0.5, 0.5],
]

export class ForceCollision extends CoreModule {
  /**
   * The one grid every offset pass builds and reads in turn: COLLISION_GRID_SIZE²
   * rgba32float, 16 MiB. Each pass rebuilds it and folds its force into the
   * velocity before the next one, so the four passes never need four grids
   * (64 MiB). Measured, the sequence costs ~0.1 ms a step over four grids at
   * 5k–20k points and nothing at 100k. All told — with the data-bounds
   * reduction — collision costs a fixed ~0.3 ms a step more than the
   * space-anchored grid it replaced, on an M3 Max: 9–13% of a step at 5k–20k
   * points, 2–3% at 100k, and over half for a few hundred points, whose step
   * costs little else.
   */
  private gridTarget: GridTarget | undefined
  private sizeTexture: Texture | undefined
  private pointIndices: Buffer | undefined
  private forceVertexCoordBuffer: Buffer | undefined

  private buildGridCommand: Model | undefined
  private forceCommand: Model | undefined

  /**
   * This tick's data bounds — the origin every offset pass counts its cells
   * from. Its own instance rather than the many-body force's: collision is
   * opt-in and must work with repulsion off, and it runs after the link and
   * cluster sub-steps have moved the points, so it reduces the positions it is
   * about to bin.
   */
  private dataBounds: DataBounds | undefined

  private buildGridUniformStore: UniformStore<{
    buildGridUniforms: {
      gridOffset: [number, number];
      cellsPerUnit: number;
      rotationSeed: number;
    };
  }> | undefined

  private forceUniformStore: UniformStore<{
    forceCollisionUniforms: {
      alpha: number;
      collisionStrength: number;
      collisionRadius: number;
      collisionPadding: number;
      pointsNumber: number;
      gridOffset: [number, number];
      cellsPerUnit: number;
      rotationSeed: number;
    };
  }> | undefined

  /**
   * The hash's cell, in world units: the contact range, whatever the layout's
   * size — a wider layout wraps around the grid instead (collision-grid.ts).
   */
  private cellSize = 0
  /**
   * Collision passes run so far, which pick each tick's rotation of the hash
   * (collisionRotationSeed): the cells that share a texel past the grid's
   * width change from tick to tick, so no point stays hidden behind one.
   */
  private tick = 0
  private previousPointsTextureSize: number | undefined

  public create (): void {
    const { device, store, data, config } = this
    if (!store.pointsTextureSize || data.pointsNumber === undefined) return

    // The cell size comes from the largest collision radius. Scan the size
    // buffer instead of spreading it into Math.max — spreading a large typed
    // array as arguments can throw a RangeError on big graphs.
    const defaultSize = config.pointDefaultSize ?? defaultConfigValues.pointDefaultSize
    let maxSize = defaultSize
    if (data.pointSizes && data.pointsNumber !== undefined) {
      // Resolve sizes: raw input arrays may hold NaN ("use the default"), which
      // would poison Math.max.
      for (let i = 0; i < data.pointsNumber; i++) maxSize = Math.max(maxSize, data.getResolvedPointSize(i))
    }
    const collisionRadius = config.simulationCollisionRadius ?? 0
    const collisionPadding = config.simulationCollisionPadding ?? 0
    const effectiveRadius = (collisionRadius > 0 ? collisionRadius : maxSize * 0.5) + collisionPadding

    // Two touching points interact up to 2 × effectiveRadius apart, and the 3x3
    // neighbourhood scan only reaches one cell of separation, so the cell must
    // span the full interaction range. The offset passes shuffle cell alignment
    // to catch boundary collisions; they do not extend the search radius. Nor
    // is it ever wider: the force reads a cell's centroid, which stands in for
    // its points only while they are within a contact range of it.
    this.cellSize = Math.max(effectiveRadius * 2, 8)

    // The grid is a scratch buffer (cleared and rebuilt by every offset pass
    // in run()) of a fixed size, so allocate it once and reuse it on every
    // later create().
    if (!this.gridTarget || this.gridTarget.texture.destroyed || this.gridTarget.fbo.destroyed) {
      this.destroyGridTarget()
      const texture = device.createTexture({
        width: COLLISION_GRID_SIZE,
        height: COLLISION_GRID_SIZE,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      })
      const fbo = device.createFramebuffer({
        width: COLLISION_GRID_SIZE,
        height: COLLISION_GRID_SIZE,
        colorAttachments: [texture],
      })
      this.gridTarget = { texture, fbo }
    }

    // Create size texture for collision radius calculation
    const sizeState = new Float32Array(store.pointsTextureSize * store.pointsTextureSize * 4)
    for (let i = 0; i < data.pointsNumber; i++) {
      sizeState[i * 4] = data.getResolvedPointSize(i)
    }

    const recreateSizeTexture =
      !this.sizeTexture ||
      this.sizeTexture.destroyed ||
      this.sizeTexture.width !== store.pointsTextureSize ||
      this.sizeTexture.height !== store.pointsTextureSize

    if (recreateSizeTexture) {
      if (this.sizeTexture && !this.sizeTexture.destroyed) this.sizeTexture.destroy()
      this.sizeTexture = device.createTexture({
        width: store.pointsTextureSize,
        height: store.pointsTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.COPY_DST,
      })
    }
    this.sizeTexture!.copyImageData({
      data: sizeState,
      bytesPerRow: getBytesPerRow('rgba32float', store.pointsTextureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    })

    // Create / update point indices buffer
    if (!this.pointIndices || this.previousPointsTextureSize !== store.pointsTextureSize) {
      if (this.pointIndices && !this.pointIndices.destroyed) this.pointIndices.destroy()
      this.pointIndices = device.createBuffer({
        data: createIndexesForBuffer(store.pointsTextureSize),
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
      this.buildGridCommand?.setAttributes({
        pointIndices: this.pointIndices,
      })
    }

    this.previousPointsTextureSize = store.pointsTextureSize
  }

  public initPrograms (): void {
    const { device, store, data } = this
    if (!data.pointsNumber || !store.pointsTextureSize) return

    // Allocates its fixed-size targets on its first run.
    this.dataBounds ||= new DataBounds(device)

    // Build-grid command: positions each point into its grid cell (additive accumulation)
    this.buildGridUniformStore ||= new UniformStore(device, {
      buildGridUniforms: {
        uniformTypes: {
          gridOffset: 'vec2<f32>',
          cellsPerUnit: 'f32',
          rotationSeed: 'f32',
        },
      },
    })

    this.buildGridCommand ||= new Model(device, {
      fs: buildGridFrag,
      vs: withCollisionGrid(buildGridVert),
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
        buildGridUniforms: this.buildGridUniformStore.getManagedUniformBuffer('buildGridUniforms'),
        // Texture bindings set dynamically in run()
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

    // Collision force command: reads the spatial hash grid (additive accumulation)
    this.forceUniformStore ||= new UniformStore(device, {
      forceCollisionUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          alpha: 'f32',
          collisionStrength: 'f32',
          collisionRadius: 'f32',
          collisionPadding: 'f32',
          pointsNumber: 'f32',
          gridOffset: 'vec2<f32>',
          cellsPerUnit: 'f32',
          rotationSeed: 'f32',
        },
      },
    })

    this.forceVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    this.forceCommand ||= new Model(device, {
      fs: withCollisionGrid(forceFrag),
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
        forceCollisionUniforms: this.forceUniformStore.getManagedUniformBuffer('forceCollisionUniforms'),
        // Texture bindings set dynamically in run()
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

  public run (): void {
    const { device, store, data, points, config } = this
    if (!points) return
    if (!this.buildGridCommand || !this.buildGridUniformStore) return
    if (!this.forceCommand || !this.forceUniformStore) return
    if (!this.pointIndices) return
    if (data.pointsNumber === undefined) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return
    if (!this.sizeTexture || this.sizeTexture.destroyed) return
    const grid = this.gridTarget
    if (!grid || grid.fbo.destroyed || grid.texture.destroyed) return
    if (!this.dataBounds || !store.pointsTextureSize) return
    // Skip if sizes changed and create() wasn't called yet
    if (store.pointsTextureSize !== this.previousPointsTextureSize) return

    const collisionRadius = config.simulationCollisionRadius ?? 0
    const collisionPadding = config.simulationCollisionPadding ?? 0

    // Where the points are, this tick: the origin every pass below counts
    // cells from, reduced from the positions they read. Only the origin is
    // read — the cell is the contact range, not a fraction of the box. The
    // floor is about where that origin sits: a box floored at the grid's
    // width centres a narrower layout in it, so the origin follows the
    // layout's centre, which holds still while the layout grows or shrinks
    // evenly. A box fitted to the points would put it on their minimum
    // corner, which moves whenever an extreme point does — and every move
    // re-cuts every cell under points that have not moved. Measured on the
    // collision stress test (50k points under gravity, 300 and 600 steps):
    // fitted, 5–9% more deep overlaps than the space-anchored hash; floored,
    // as few or fewer. A layout wider than the grid fills its box, and the
    // origin is its corner again — such a layout shares texels already.
    this.dataBounds.run({
      positionsTexture: points.previousPositionTexture,
      exitTexture: points.exitTexture,
      pointsTextureSize: store.pointsTextureSize,
      pointsNumber: data.pointsNumber,
      minExtent: this.cellSize * COLLISION_GRID_SIZE,
    })
    const dataBoundsTexture = this.dataBounds.texture
    if (!dataBoundsTexture) return
    // Taken once here, so both programs scale by the same bits (collision-grid.ts).
    const cellsPerUnit = 1 / this.cellSize
    const rotationSeed = collisionRotationSeed(this.tick)
    this.tick = (this.tick + 1) % COLLISION_GRID_SIZE

    // The bindings are constant across the offset passes, so set them once;
    // only the uniforms change from pass to pass.
    this.buildGridCommand.setVertexCount(data.pointsNumber)
    this.buildGridCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      sizeTexture: this.sizeTexture,
      exitTexture: points.exitTexture,
      dataBoundsTexture,
    })
    this.forceCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      sizeTexture: this.sizeTexture,
      gridTexture: grid.texture,
      dataBoundsTexture,
    })

    // Each offset pass builds its grid, then adds its force to the velocity
    // before the next pass rebuilds the same grid on a shifted lattice. The
    // velocity is cleared by the first pass only and blended additively after,
    // so it sums the four passes' forces in the same order as one pass over
    // four grids would — with a quarter of the memory.
    for (const [i, gridOffset] of GRID_OFFSETS.entries()) {
      this.buildGridUniformStore.setUniforms({
        buildGridUniforms: {
          gridOffset,
          cellsPerUnit,
          rotationSeed,
        },
      })
      const gridPass = device.beginRenderPass({
        framebuffer: grid.fbo,
        clearColor: [0, 0, 0, 0],
      })
      this.buildGridCommand.draw(gridPass)
      gridPass.end()

      this.forceUniformStore.setUniforms({
        forceCollisionUniforms: {
          alpha: store.alpha,
          collisionStrength: config.simulationCollision ?? 0,
          collisionRadius,
          collisionPadding,
          pointsNumber: data.pointsNumber,
          gridOffset,
          cellsPerUnit,
          rotationSeed,
        },
      })
      const forcePass = device.beginRenderPass({
        framebuffer: points.velocityFbo,
        clearColor: i === 0 ? [0, 0, 0, 0] : false,
      })
      this.forceCommand.draw(forcePass)
      forcePass.end()
    }
  }

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   */
  public destroy (): void {
    // 1. Destroy Models FIRST
    this.buildGridCommand?.destroy()
    this.buildGridCommand = undefined
    this.forceCommand?.destroy()
    this.forceCommand = undefined

    // 2. Destroy the Framebuffer (before the texture it references) & 3. its texture
    this.destroyGridTarget()
    // Self-contained (its own Models -> Framebuffers -> Textures -> UniformStores
    // -> Buffers); after the Models above, which bind its texture.
    this.dataBounds?.destroy()
    this.dataBounds = undefined

    // 3. Destroy remaining Textures
    if (this.sizeTexture && !this.sizeTexture.destroyed) this.sizeTexture.destroy()
    this.sizeTexture = undefined

    // 4. Destroy UniformStores
    this.buildGridUniformStore?.destroy()
    this.buildGridUniformStore = undefined
    this.forceUniformStore?.destroy()
    this.forceUniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models)
    if (this.pointIndices && !this.pointIndices.destroyed) this.pointIndices.destroy()
    this.pointIndices = undefined
    if (this.forceVertexCoordBuffer && !this.forceVertexCoordBuffer.destroyed) this.forceVertexCoordBuffer.destroy()
    this.forceVertexCoordBuffer = undefined
  }

  private destroyGridTarget (): void {
    if (this.gridTarget && !this.gridTarget.fbo.destroyed) this.gridTarget.fbo.destroy()
    if (this.gridTarget && !this.gridTarget.texture.destroyed) this.gridTarget.texture.destroy()
    this.gridTarget = undefined
  }
}
