import { Buffer, Framebuffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule, BASE_PIPELINE_PARAMETERS } from '@/graph/modules/core-module'

import forceAllPairsFrag from '@/graph/modules/ForceCollision/force-collision-allpairs.frag?raw'
import forceSlotsFrag from '@/graph/modules/ForceCollision/force-collision-slots.frag?raw'
import peelSlotsVert from '@/graph/modules/ForceManyBody/build-nearfield-slots.vert?raw'
import peelSlotsFrag from '@/graph/modules/ForceManyBody/build-nearfield-slots.frag?raw'
import { collisionRotationSeed, withCollisionGrid } from '@/graph/modules/ForceCollision/collision-grid'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import { getFinestGridSize, getNearFieldSlotCount } from '@/graph/modules/Shared/cell-slots'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'
import { defaultConfigValues } from '@/graph/variables'

/**
 * At or below this many points collision is exact in one full-screen pass that
 * tests every pair (`force-collision-allpairs.frag`). Above it, a spatial hash
 * with depth-peeled per-cell point slots takes over (`force-collision-slots.frag`):
 * pairwise too, exhaustive while each queried hash bucket holds at most
 * `getNearFieldSlotCount` points, and sampling a fresh subset in denser buckets.
 * Distant cells share the slot budget; candidates are checked by world cell.
 *
 * Same threshold as the many-body force. Around it the two paths cost about
 * the same: measured end to end on an Apple M3 Max, 2.7 ms per pass for the
 * all-pairs loop at 4,000 points and 2.4 ms for the slot path at 5,000 (32
 * slots, a cost dominated by one render pass per peeled slot rather than by
 * the point count). The all-pairs side grows with n², so doubling the
 * threshold would roughly quadruple it.
 */
export const ALL_PAIRS_MAX_POINTS = 4096

/** A depth-peeling render target ([point index, hash] per cell). */
type SlotTarget = {
  texture: Texture;
  fbo: Framebuffer;
}

/** Ping-pong pair: each peel pass writes one and reads the other. */
const PEEL_TARGETS = 2

/**
 * GPU collision force: discs of radius `size / 2` (or a fixed radius), plus
 * padding, pushed apart wherever they overlap.
 *
 * It is a constraint, not a force. Every overlapping pair is projected to
 * contact along the line of centers, split by r² so the smaller disc yields
 * (d3-force's forceCollide), scaled by `simulationCollision` and capped at one
 * own radius per pass. The correction is not scaled by alpha (unless
 * `simulationCollisionCooling` opts in) and the simulation integrates it with
 * friction 1, so overlap keeps resolving at full strength while the layout
 * cools; `simulationCollisionIterations` repeats the pass per tick. While
 * collision is on, the link force reads
 * `resolvedSizeTexture` to floor each spring's rest length at the contact
 * distance, so the springs never demand overlap.
 *
 * Two paths, split at ALL_PAIRS_MAX_POINTS: exact all-pairs below, and above it
 * a uniform grid whose cell spans the contact range (so the 3×3 neighbourhood
 * is exhaustive) with K depth-peeled point slots per hash bucket, built every
 * pass with the many-body force's peel shader. Cells are counted from the
 * world origin and hashed onto the slot grid (collision-grid.ts), so nothing
 * about the layout is measured first. Aliased cells share that budget.
 */
export class ForceCollision extends CoreModule {
  private tick = 0
  private sizeTexture: Texture | undefined
  private pointIndices: Buffer | undefined
  private vertexCoordBuffer: Buffer | undefined

  /** Slot count for the current point count (getNearFieldSlotCount); 0 on the all-pairs path. */
  private slotCount = 0
  /**
   * Per-cell point slots: one sampler2DArray layer per depth-peeling pass, each
   * holding [point index, hash] per grid cell — rebuilt every pass.
   */
  private slotsArrayTexture: Texture | undefined
  /**
   * The two ping-pong peel render targets: pass k draws into k % 2 while
   * reading the previous pass's result from (k + 1) % 2, then the result is
   * copied into layer k of slotsArrayTexture (sampling one layer of a texture
   * while rendering to another is a WebGL feedback loop).
   */
  private peelTargets: SlotTarget[] = []

  private peelCommand: Model | undefined
  private forceSlotsCommand: Model | undefined
  private forceAllPairsCommand: Model | undefined

  private peelUniformStore: UniformStore<{
    buildNearFieldSlotsUniforms: {
      pointsTextureSize: number;
      levelGridSize: number;
      hasPreviousSlot: number;
      randomSeed: number;
      cellsPerUnit: number;
      rotationSeed: number;
      collisionOrigin: [number, number];
    };
  }> | undefined

  private forceSlotsUniformStore: UniformStore<{
    forceCollisionSlotsUniforms: {
      pointsTextureSize: number;
      gridSize: number;
      slotCount: number;
      collisionStrength: number;
      collisionRadius: number;
      collisionPadding: number;
      alpha: number;
      collisionCooling: number;
      cellsPerUnit: number;
      rotationSeed: number;
      collisionOrigin: [number, number];
    };
  }> | undefined

  private forceAllPairsUniformStore: UniformStore<{
    forceCollisionAllPairsUniforms: {
      pointsTextureSize: number;
      pointsNumber: number;
      collisionStrength: number;
      collisionRadius: number;
      collisionPadding: number;
      maxRadius: number;
      alpha: number;
      collisionCooling: number;
    };
  }> | undefined

  /** Cells per axis of the slot grid; 0 on the all-pairs path. */
  private gridSize = 0
  private cellSize = 0
  /** The largest effective radius in the graph (fixed or size-derived, plus padding). */
  private maxRadius = 0
  private previousPointsTextureSize: number | undefined

  /**
   * The resolved point sizes (`r` channel), one texel per point, laid out like the
   * position texture. Built by `create()`; the link force reads it to keep spring
   * rest lengths from demanding overlap. `undefined` until collision first runs.
   */
  public get resolvedSizeTexture (): Texture | undefined {
    if (!this.sizeTexture || this.sizeTexture.destroyed) return undefined
    return this.sizeTexture
  }

  /** Small graphs skip the grid entirely (see ALL_PAIRS_MAX_POINTS). */
  private get usesAllPairs (): boolean {
    return (this.data.pointsNumber ?? 0) <= ALL_PAIRS_MAX_POINTS
  }

  public create (): void {
    const { device, store, data, config } = this
    if (!store.pointsTextureSize || data.pointsNumber === undefined) return

    // The largest effective radius sizes the grid cell and bounds the all-pairs
    // pair reject. Scan the size buffer instead of spreading it into Math.max —
    // spreading a large typed array as arguments can throw a RangeError on big
    // graphs — and resolve sizes, since raw input arrays may hold NaN ("use the
    // default"), which would poison Math.max.
    const defaultSize = config.pointDefaultSize ?? defaultConfigValues.pointDefaultSize
    let maxSize = defaultSize
    if (data.pointSizes && data.pointsNumber !== undefined) {
      for (let i = 0; i < data.pointsNumber; i++) maxSize = Math.max(maxSize, data.getResolvedPointSize(i))
    }
    const collisionRadius = config.simulationCollisionRadius ?? 0
    const collisionPadding = config.simulationCollisionPadding ?? 0
    this.maxRadius = (collisionRadius > 0 ? collisionRadius : maxSize * 0.5) + collisionPadding

    if (this.usesAllPairs) {
      // The exact path needs no grid; free one left over from a larger graph.
      this.destroySlotTargets()
      this.gridSize = 0
      this.cellSize = 0
    } else {
      // Keep contact-sized cells at any world extent. The data-relative hash
      // wraps them onto the same point-count-bounded slot textures as repulsion.
      this.gridSize = getFinestGridSize(data.pointsNumber)
      this.cellSize = Math.max(this.maxRadius * 2, 8)
      this.createSlotTargets()
    }

    // Resolved sizes, for the collision radii and the link force's rest-length floor
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

    // Point indices for the peel draw (one vertex per point)
    if (!this.pointIndices || this.previousPointsTextureSize !== store.pointsTextureSize) {
      if (this.pointIndices && !this.pointIndices.destroyed) this.pointIndices.destroy()
      this.pointIndices = device.createBuffer({
        data: createIndexesForBuffer(store.pointsTextureSize),
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
      this.peelCommand?.setAttributes({
        pointIndices: this.pointIndices,
      })
    }

    this.previousPointsTextureSize = store.pointsTextureSize
  }

  public initPrograms (): void {
    const { device, store, data } = this
    if (!data.pointsNumber || !store.pointsTextureSize) return

    this.vertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    // Exact all-pairs command for small graphs (see ALL_PAIRS_MAX_POINTS)
    this.forceAllPairsUniformStore ||= new UniformStore(device, {
      forceCollisionAllPairsUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
          pointsNumber: 'f32',
          collisionStrength: 'f32',
          collisionRadius: 'f32',
          collisionPadding: 'f32',
          maxRadius: 'f32',
          alpha: 'f32',
          collisionCooling: 'f32',
        },
      },
    })

    this.forceAllPairsCommand ||= new Model(device, {
      fs: forceAllPairsFrag,
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.vertexCoordBuffer,
      },
      bufferLayout: [
        { name: 'vertexCoord', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        forceCollisionAllPairsUniforms: this.forceAllPairsUniformStore.getManagedUniformBuffer('forceCollisionAllPairsUniforms'),
        // Texture bindings set dynamically in drawAllPairs()
      },
      parameters: BASE_PIPELINE_PARAMETERS,
    })

    // Slot peeling command (point list; the depth test selects the eligible
    // point with the smallest per-pass hash per cell). The uniform block name
    // is the peel shader's.
    this.peelUniformStore ||= new UniformStore(device, {
      buildNearFieldSlotsUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
          levelGridSize: 'f32',
          hasPreviousSlot: 'f32',
          randomSeed: 'f32',
          cellsPerUnit: 'f32',
          rotationSeed: 'f32',
          collisionOrigin: 'vec2<f32>',
        },
      },
    })

    this.peelCommand ||= new Model(device, {
      fs: peelSlotsFrag,
      vs: withCollisionGrid(peelSlotsVert),
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
        COLLISION_SLOTS: true,
      },
      bindings: {
        buildNearFieldSlotsUniforms: this.peelUniformStore.getManagedUniformBuffer('buildNearFieldSlotsUniforms'),
        // Texture bindings set dynamically in drawSlots()
      },
      parameters: {
        ...BASE_PIPELINE_PARAMETERS,
        blend: false,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    })

    // Slot contact command: one fragment per point, resolving against the
    // peeled slots of its 3×3 cells
    this.forceSlotsUniformStore ||= new UniformStore(device, {
      forceCollisionSlotsUniforms: {
        uniformTypes: {
          // Order MUST match shader declaration order (std140 layout)
          pointsTextureSize: 'f32',
          gridSize: 'f32',
          slotCount: 'f32',
          collisionStrength: 'f32',
          collisionRadius: 'f32',
          collisionPadding: 'f32',
          alpha: 'f32',
          collisionCooling: 'f32',
          cellsPerUnit: 'f32',
          rotationSeed: 'f32',
          collisionOrigin: 'vec2<f32>',
        },
      },
    })

    this.forceSlotsCommand ||= new Model(device, {
      fs: withCollisionGrid(forceSlotsFrag),
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.vertexCoordBuffer,
      },
      bufferLayout: [
        { name: 'vertexCoord', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        forceCollisionSlotsUniforms: this.forceSlotsUniformStore.getManagedUniformBuffer('forceCollisionSlotsUniforms'),
        // Texture bindings set dynamically in drawSlots()
      },
      parameters: BASE_PIPELINE_PARAMETERS,
    })
  }

  public run (): void {
    const { store, data, points } = this
    if (!points) return
    if (data.pointsNumber === undefined) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return
    if (!this.sizeTexture || this.sizeTexture.destroyed) return
    // Skip if sizes changed and create() wasn't called yet
    if (store.pointsTextureSize !== this.previousPointsTextureSize) return

    if (this.usesAllPairs) this.drawAllPairs()
    else this.drawSlots()
  }

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   */
  public destroy (): void {
    // 1. Destroy Models FIRST
    this.peelCommand?.destroy()
    this.peelCommand = undefined
    this.forceSlotsCommand?.destroy()
    this.forceSlotsCommand = undefined
    this.forceAllPairsCommand?.destroy()
    this.forceAllPairsCommand = undefined

    // 2. Destroy Framebuffers (before the textures they reference) & their textures
    this.destroySlotTargets()

    // 3. Destroy remaining Textures
    if (this.sizeTexture && !this.sizeTexture.destroyed) this.sizeTexture.destroy()
    this.sizeTexture = undefined

    // 4. Destroy UniformStores
    this.peelUniformStore?.destroy()
    this.peelUniformStore = undefined
    this.forceSlotsUniformStore?.destroy()
    this.forceSlotsUniformStore = undefined
    this.forceAllPairsUniformStore?.destroy()
    this.forceAllPairsUniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models)
    if (this.pointIndices && !this.pointIndices.destroyed) this.pointIndices.destroy()
    this.pointIndices = undefined
    if (this.vertexCoordBuffer && !this.vertexCoordBuffer.destroyed) this.vertexCoordBuffer.destroy()
    this.vertexCoordBuffer = undefined
  }

  /**
   * The small-graph path: one exact all-pairs pass into the velocity FBO.
   */
  private drawAllPairs (): void {
    const { device, store, data, points, config } = this
    if (!points || !points.previousPositionTexture || !points.exitTexture || !points.velocityFbo || !this.sizeTexture) return
    if (!this.forceAllPairsCommand || !this.forceAllPairsUniformStore) return
    if (!data.pointsNumber) return

    this.forceAllPairsUniformStore.setUniforms({
      forceCollisionAllPairsUniforms: {
        pointsTextureSize: store.pointsTextureSize ?? 0,
        pointsNumber: data.pointsNumber,
        collisionStrength: config.simulationCollision ?? 0,
        collisionRadius: config.simulationCollisionRadius ?? 0,
        collisionPadding: config.simulationCollisionPadding ?? 0,
        maxRadius: this.maxRadius,
        alpha: store.alpha,
        collisionCooling: config.simulationCollisionCooling ?? 0,
      },
    })

    this.forceAllPairsCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      sizeTexture: this.sizeTexture,
      exitTexture: points.exitTexture,
    })

    const pass = device.beginRenderPass({
      framebuffer: points.velocityFbo,
      clearColor: [0, 0, 0, 0],
    })
    this.forceAllPairsCommand.draw(pass)
    pass.end()
  }

  /**
   * The large-graph path. First `slotCount` depth-peeling passes over the
   * points, each capturing the eligible point with the smallest per-pass random
   * hash per cell (see build-nearfield-slots.vert) and publishing it as one
   * layer of the slot array; re-seeded every pass so a dense cell rotates all
   * its points through contact. Then one full-screen pass resolves every point
   * against the slots of its 3×3 cells, into the velocity FBO.
   */
  private drawSlots (): void {
    const { device, store, data, points, config } = this
    if (!points || !points.previousPositionTexture || !points.exitTexture || !points.velocityFbo || !this.sizeTexture) return
    if (!this.peelCommand || !this.peelUniformStore) return
    if (!this.forceSlotsCommand || !this.forceSlotsUniformStore) return
    if (!this.pointIndices || !data.pointsNumber) return
    if (this.peelTargets.length !== PEEL_TARGETS) return
    if (!this.slotsArrayTexture || this.slotsArrayTexture.destroyed) return
    if (!this.gridSize || !this.slotCount) return

    const cellsPerUnit = 1 / this.cellSize
    const rotationSeed = collisionRotationSeed(this.tick++)
    const randomSeed = store.getRandomFloat(0, 1)

    this.peelCommand.setVertexCount(data.pointsNumber)
    for (let slot = 0; slot < this.slotCount; slot += 1) {
      const target = this.peelTargets[slot % PEEL_TARGETS]
      const previous = this.peelTargets[(slot + 1) % PEEL_TARGETS]
      if (!target || target.fbo.destroyed || !previous || previous.texture.destroyed) continue

      this.peelUniformStore.setUniforms({
        buildNearFieldSlotsUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          levelGridSize: this.gridSize,
          hasPreviousSlot: slot === 0 ? 0 : 1,
          // The seed is shared by all slots of one pass — peeling relies on a
          // consistent hash ordering across them.
          randomSeed,
          cellsPerUnit,
          rotationSeed,
          collisionOrigin: store.worldOrigin,
        },
      })

      this.peelCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        exitTexture: points.exitTexture,
        // Pass 0 never samples previousSlot, but the binding must exist for the
        // draw to run — any texture that is not the render target works.
        previousSlot: slot === 0 ? points.previousPositionTexture : previous.texture,
      })

      const peelPass = device.beginRenderPass({
        framebuffer: target.fbo,
        // Cleared slot = empty: index -1 with hash 1 keeps later passes ineligible
        clearColor: [-1, 1, 0, 0],
        clearDepth: 1,
      })
      this.peelCommand.draw(peelPass)
      peelPass.end()

      // Publish this pass's result as layer `slot` of the array the force pass reads
      const commandEncoder = device.createCommandEncoder()
      commandEncoder.copyTextureToTexture({
        sourceTexture: target.texture,
        destinationTexture: this.slotsArrayTexture,
        destinationOrigin: [0, 0, slot],
        width: this.gridSize,
        height: this.gridSize,
      })
      // finish() destroys the encoder itself and returns the command buffer.
      device.submit(commandEncoder.finish())
    }

    this.forceSlotsUniformStore.setUniforms({
      forceCollisionSlotsUniforms: {
        pointsTextureSize: store.pointsTextureSize ?? 0,
        gridSize: this.gridSize,
        slotCount: this.slotCount,
        collisionStrength: config.simulationCollision ?? 0,
        collisionRadius: config.simulationCollisionRadius ?? 0,
        collisionPadding: config.simulationCollisionPadding ?? 0,
        alpha: store.alpha,
        collisionCooling: config.simulationCollisionCooling ?? 0,
        cellsPerUnit,
        rotationSeed,
        collisionOrigin: store.worldOrigin,
      },
    })

    this.forceSlotsCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      sizeTexture: this.sizeTexture,
      exitTexture: points.exitTexture,
      slotsTexture: this.slotsArrayTexture,
    })

    const forcePass = device.beginRenderPass({
      framebuffer: points.velocityFbo,
      clearColor: [0, 0, 0, 0],
    })
    this.forceSlotsCommand.draw(forcePass)
    forcePass.end()
  }

  /**
   * Allocates the slot resources for the current grid: the two ping-pong
   * depth-peeling targets ([point index, hash] per cell, with a depth
   * attachment each for the peel's smallest-hash selection) and the slot array
   * texture (one layer per peeling pass) that the force pass reads. Reused when
   * the grid size and slot count are unchanged.
   */
  private createSlotTargets (): void {
    const { device } = this
    const slots = getNearFieldSlotCount(this.data.pointsNumber ?? 0)
    const existing = this.peelTargets[0]
    if (
      existing &&
      !existing.texture.destroyed &&
      existing.texture.width === this.gridSize &&
      existing.texture.height === this.gridSize &&
      this.peelTargets.length === PEEL_TARGETS &&
      this.slotsArrayTexture &&
      !this.slotsArrayTexture.destroyed &&
      this.slotCount === slots
    ) return

    this.destroySlotTargets()
    this.slotCount = slots
    for (let target = 0; target < PEEL_TARGETS; target += 1) {
      const texture = device.createTexture({
        width: this.gridSize,
        height: this.gridSize,
        format: 'rg32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_SRC,
      })
      const fbo = device.createFramebuffer({
        width: this.gridSize,
        height: this.gridSize,
        colorAttachments: [texture],
        // Depth resolution must cover the 24-bit peel hash: the depth test picks
        // each slot's winner, but the next pass's eligibility compares the full
        // hash from the color target. A 16-bit depth buffer quantizes ties into
        // existence, and a tie resolved by draw order can exclude the true
        // smallest-hash point from the whole pass's sample.
        depthStencilAttachment: 'depth24plus',
      })
      this.peelTargets.push({ texture, fbo })
    }
    this.slotsArrayTexture = device.createTexture({
      dimension: '2d-array',
      width: this.gridSize,
      height: this.gridSize,
      depth: slots,
      format: 'rg32float',
      usage: Texture.SAMPLE | Texture.COPY_DST,
    })
  }

  private destroySlotTargets (): void {
    for (const target of this.peelTargets) {
      if (!target.fbo.destroyed) target.fbo.destroy()
    }
    for (const target of this.peelTargets) {
      if (!target.texture.destroyed) target.texture.destroy()
    }
    this.peelTargets = []
    if (this.slotsArrayTexture && !this.slotsArrayTexture.destroyed) this.slotsArrayTexture.destroy()
    this.slotsArrayTexture = undefined
    this.slotCount = 0
  }
}
