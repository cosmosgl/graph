import { Buffer, Framebuffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'

import buildGridVert from '@/graph/modules/ForceCollision/build-grid.vert?raw'
import buildGridFrag from '@/graph/modules/ForceCollision/build-grid.frag?raw'
import forceFrag from '@/graph/modules/ForceCollision/force-collision-spatial.frag?raw'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'
import { defaultConfigValues } from '@/graph/variables'

type GridTarget = {
  texture: Texture;
  fbo: Framebuffer;
}

// Grid offsets for multiple passes (improves collision detection at cell boundaries)
const GRID_OFFSETS: [number, number][] = [
  [0.0, 0.0],
  [0.5, 0.0],
  [0.0, 0.5],
  [0.5, 0.5],
]

export class ForceCollision extends CoreModule {
  private gridTargets: GridTarget[] = []
  private sizeTexture: Texture | undefined
  private pointIndices: Buffer | undefined
  private forceVertexCoordBuffer: Buffer | undefined

  private buildGridCommand: Model | undefined
  private forceCommand: Model | undefined

  private buildGridUniformStore: UniformStore<{
    buildGridUniforms: {
      pointsTextureSize: number;
      gridTextureSize: number;
      cellSize: number;
      gridOffset: [number, number];
    };
  }> | undefined

  private forceUniformStore: UniformStore<{
    forceCollisionUniforms: {
      pointsTextureSize: number;
      gridTextureSize: number;
      cellSize: number;
      alpha: number;
      collisionStrength: number;
      collisionRadius: number;
      collisionPadding: number;
      pointsNumber: number;
      gridOffset: [number, number];
    };
  }> | undefined

  private gridTextureSize = 0
  private cellSize = 0
  private previousPointsTextureSize: number | undefined
  private previousSpaceSize: number | undefined

  public create (): void {
    const { device, store, data, config } = this
    if (!store.pointsTextureSize || data.pointsNumber === undefined) return

    // Calculate grid size based on space size and collision radius.
    // Scan the size buffer instead of spreading it into Math.max — spreading a
    // large typed array as arguments can throw a RangeError on big graphs.
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

    // Cell size = collision radius (smaller cells = better accuracy).
    // We use multiple offset passes to catch boundary collisions.
    this.cellSize = Math.max(effectiveRadius, 8)

    // Grid texture size = space size / cell size, clamped to reasonable values
    this.gridTextureSize = Math.min(
      512,
      Math.max(32, Math.ceil(store.adjustedSpaceSize / this.cellSize))
    )

    // Recalculate cell size to fit the grid evenly
    this.cellSize = store.adjustedSpaceSize / this.gridTextureSize

    // Allocate one grid framebuffer per offset pass. These are scratch buffers
    // (cleared and rebuilt every tick in run()), so reuse them when the grid
    // dimensions are unchanged instead of reallocating on every create().
    const gridTargetsValid =
      this.gridTargets.length === GRID_OFFSETS.length &&
      this.gridTargets.every((t) => !t.texture.destroyed && !t.fbo.destroyed && t.texture.width === this.gridTextureSize)
    if (!gridTargetsValid) {
      this.destroyGridTargets()
      this.gridTargets = GRID_OFFSETS.map(() => {
        const texture = device.createTexture({
          width: this.gridTextureSize,
          height: this.gridTextureSize,
          format: 'rgba32float',
          usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
        })
        const fbo = device.createFramebuffer({
          width: this.gridTextureSize,
          height: this.gridTextureSize,
          colorAttachments: [texture],
        })
        return { texture, fbo }
      })
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
    this.previousSpaceSize = store.adjustedSpaceSize
  }

  public initPrograms (): void {
    const { device, store, data } = this
    if (!data.pointsNumber || !store.pointsTextureSize) return

    // Build-grid command: positions each point into its grid cell (additive accumulation)
    this.buildGridUniformStore ||= new UniformStore(device, {
      buildGridUniforms: {
        uniformTypes: {
          pointsTextureSize: 'f32',
          gridTextureSize: 'f32',
          cellSize: 'f32',
          gridOffset: 'vec2<f32>',
        },
      },
    })

    this.buildGridCommand ||= new Model(device, {
      fs: buildGridFrag,
      vs: buildGridVert,
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
          pointsTextureSize: 'f32',
          gridTextureSize: 'f32',
          cellSize: 'f32',
          alpha: 'f32',
          collisionStrength: 'f32',
          collisionRadius: 'f32',
          collisionPadding: 'f32',
          pointsNumber: 'f32',
          gridOffset: 'vec2<f32>',
        },
      },
    })

    this.forceVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    this.forceCommand ||= new Model(device, {
      fs: forceFrag,
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
    if (this.gridTargets.length !== GRID_OFFSETS.length) return
    // Skip if sizes changed and create() wasn't called yet
    if (store.pointsTextureSize !== this.previousPointsTextureSize || store.adjustedSpaceSize !== this.previousSpaceSize) return

    const collisionRadius = config.simulationCollisionRadius ?? 0
    const collisionPadding = config.simulationCollisionPadding ?? 0

    // Step 1: Build the spatial hash grid for each offset pass.
    // Each grid is cleared and accumulated within its own render pass.
    this.buildGridCommand.setVertexCount(data.pointsNumber)
    this.buildGridCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      sizeTexture: this.sizeTexture,
      exitTexture: points.exitTexture,
    })
    for (const [i, gridOffset] of GRID_OFFSETS.entries()) {
      const target = this.gridTargets[i]
      if (!target || target.fbo.destroyed || target.texture.destroyed) continue

      this.buildGridUniformStore.setUniforms({
        buildGridUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          gridTextureSize: this.gridTextureSize,
          cellSize: this.cellSize,
          gridOffset,
        },
      })

      const gridPass = device.beginRenderPass({
        framebuffer: target.fbo,
        clearColor: [0, 0, 0, 0],
      })
      this.buildGridCommand.draw(gridPass)
      gridPass.end()
    }

    // Step 2: Accumulate the collision forces from all offset passes into velocityFbo
    // within a single render pass (cleared once, then blended additively).
    // The position/size bindings are constant across passes, so set them once;
    // setBindings merges, so only gridTexture changes per offset in the loop.
    this.forceCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      sizeTexture: this.sizeTexture,
    })
    const forcePass = device.beginRenderPass({
      framebuffer: points.velocityFbo,
      clearColor: [0, 0, 0, 0],
    })
    for (const [i, gridOffset] of GRID_OFFSETS.entries()) {
      const target = this.gridTargets[i]
      if (!target || target.texture.destroyed) continue

      this.forceUniformStore.setUniforms({
        forceCollisionUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          gridTextureSize: this.gridTextureSize,
          cellSize: this.cellSize,
          alpha: store.alpha,
          collisionStrength: config.simulationCollision ?? 0,
          collisionRadius,
          collisionPadding,
          pointsNumber: data.pointsNumber,
          gridOffset,
        },
      })

      this.forceCommand.setBindings({
        gridTexture: target.texture,
      })
      this.forceCommand.draw(forcePass)
    }
    forcePass.end()
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

    // 2. Destroy Framebuffers (before the textures they reference) & 3. their textures
    this.destroyGridTargets()

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

  private destroyGridTargets (): void {
    for (const target of this.gridTargets) {
      if (target.fbo && !target.fbo.destroyed) target.fbo.destroy()
    }
    for (const target of this.gridTargets) {
      if (target.texture && !target.texture.destroyed) target.texture.destroy()
    }
    this.gridTargets = []
  }
}
