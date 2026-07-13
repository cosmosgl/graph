import { Buffer, Framebuffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'

import calculateLevelFrag from '@/graph/modules/ForceManyBody/calculate-level.frag?raw'
import calculateLevelPreciseVert from '@/graph/modules/ForceManyBody/calculate-level.vert?raw'
import forceLevelPreciseFrag from '@/graph/modules/ForceManyBody/force-level.frag?raw'
import forceNearFieldFrag from '@/graph/modules/ForceManyBody/force-nearfield.frag?raw'
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
 * Depth-peeled points per finest-level cell that receive exact pairwise
 * repulsion each tick. The subset is re-randomized every tick, so points of a
 * dense cell rotate through exact treatment.
 */
const NEAR_FIELD_SLOTS = 8

/** A grid-level aggregation target ([sum(x), sum(y), count, 0] per cell). */
type LevelTarget = {
  texture: Texture;
  fbo: Framebuffer;
  /** Cells per axis of the grid this level represents. */
  gridSize: number;
}

/** A near-field depth-peeling slot target ([point index, hash] per cell). */
type SlotTarget = {
  texture: Texture;
  fbo: Framebuffer;
}

/**
 * GPU many-body (repulsion) force.
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
  /** Grid level count; `0` while the brute-force path is active. */
  private levels = 0
  private levelTargets = new Map<number, LevelTarget>()
  /**
   * Near-field point slots: NEAR_FIELD_SLOTS textures sharing the finest
   * level's grid layout, each holding [point index, hash] per cell — built by
   * depth peeling every tick (see build-nearfield-slots.vert).
   */
  private nearFieldSlotTargets: SlotTarget[] = []

  private calculateLevelsCommand: Model | undefined
  private forceLevelCommand: Model | undefined
  private buildNearFieldSlotsCommand: Model | undefined
  private forceNearFieldCommand: Model | undefined

  private forceVertexCoordBuffer: Buffer | undefined

  private calculateLevelsUniformStore: UniformStore<{
    calculateLevelsPreciseUniforms: {
      pointsTextureSize: number;
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
    };
  }> | undefined

  private previousPointsTextureSize: number | undefined
  private previousSpaceSize: number | undefined
  private previousPointsNumber: number | undefined

  public create (): void {
    const { device, store } = this
    if (!store.pointsTextureSize) return

    // Allocate the grid pyramid + near-field slots (or free them and fall back to
    // brute force below the point-count threshold).
    this.createLevels()

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
    this.previousSpaceSize = store.adjustedSpaceSize
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
          pointsTextureSize: 'f32',
          levelGridSize: 'f32',
          cellSize: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize,
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
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize,
          levelGridSize: 0,
          cellSize: 0,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
        },
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
    // Skip if sizes changed and create() wasn't called yet
    if (
      this.store.pointsTextureSize !== this.previousPointsTextureSize ||
      this.store.adjustedSpaceSize !== this.previousSpaceSize ||
      this.data.pointsNumber !== this.previousPointsNumber
    ) {
      return
    }

    // Nothing to do until the grid pyramid and near-field slots are allocated
    // (create() builds them; this guards a partial/failed allocation).
    if (this.levelTargets.size === 0 || this.nearFieldSlotTargets.length !== NEAR_FIELD_SLOTS) return

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
          pointsTextureSize: store.pointsTextureSize ?? 0,
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
   * Rebuilds the near-field point slots for this tick: NEAR_FIELD_SLOTS
   * depth-peeling passes over the points, each capturing the eligible point with
   * the smallest per-tick random hash per finest-level cell (see
   * build-nearfield-slots.vert). Re-seeded every tick so dense cells rotate all
   * their points through exact pairwise treatment.
   */
  private drawNearFieldSlots (): void {
    const { device, store, data, points } = this
    if (!points) return
    if (!this.buildNearFieldSlotsCommand || !this.buildNearFieldSlotsUniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!data.pointsNumber || !this.pointIndices) return
    const finest = this.levelTargets.get(this.levels - 1)
    if (!finest || finest.texture.destroyed) return

    const randomSeed = store.getRandomFloat(0, 1)

    for (let slot = 0; slot < this.nearFieldSlotTargets.length; slot += 1) {
      const target = this.nearFieldSlotTargets[slot]
      if (!target || target.fbo.destroyed) continue

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
          : this.nearFieldSlotTargets[slot - 1]!.texture,
      })

      const slotPass = device.beginRenderPass({
        framebuffer: target.fbo,
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
    const { device, store, points } = this
    if (!points) return
    if (!this.forceLevelCommand || !this.forceLevelUniformStore) return
    if (!this.forceNearFieldCommand || !this.forceNearFieldUniformStore) return
    if (this.nearFieldSlotTargets.length !== NEAR_FIELD_SLOTS) return
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
          },
        })

        this.forceNearFieldCommand.setBindings({
          positionsTexture: points.previousPositionTexture,
          levelTexture: target.texture,
          randomValues: this.randomValuesTexture,
          slotTexture0: this.nearFieldSlotTargets[0]!.texture,
          slotTexture1: this.nearFieldSlotTargets[1]!.texture,
          slotTexture2: this.nearFieldSlotTargets[2]!.texture,
          slotTexture3: this.nearFieldSlotTargets[3]!.texture,
          slotTexture4: this.nearFieldSlotTargets[4]!.texture,
          slotTexture5: this.nearFieldSlotTargets[5]!.texture,
          slotTexture6: this.nearFieldSlotTargets[6]!.texture,
          slotTexture7: this.nearFieldSlotTargets[7]!.texture,
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

    const targetGridSize = 2 * Math.sqrt(pointsNumber)
    const finestGridSize = Math.min(
      MAX_GRID_SIZE,
      Math.max(8, Math.pow(2, Math.ceil(Math.log2(targetGridSize))))
    )
    this.levels = Math.log2(finestGridSize) - 1

    for (let level = 0; level < this.levels; level += 1) {
      const gridSize = Math.pow(2, level + 2)

      const existingTarget = this.levelTargets.get(level)
      if (existingTarget && existingTarget.gridSize === gridSize) continue
      if (existingTarget) {
        if (!existingTarget.fbo.destroyed) existingTarget.fbo.destroy()
        if (!existingTarget.texture.destroyed) existingTarget.texture.destroy()
      }

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
   * Allocates the depth-peeling slot targets ([point index, hash] per cell) plus
   * a depth attachment each for the peel's smallest-hash selection.
   */
  private createNearFieldSlotTargets (finest: LevelTarget): void {
    const { device } = this
    const existing = this.nearFieldSlotTargets[0]
    if (
      existing &&
      !existing.texture.destroyed &&
      existing.texture.width === finest.gridSize &&
      existing.texture.height === finest.gridSize &&
      this.nearFieldSlotTargets.length === NEAR_FIELD_SLOTS
    ) return

    this.destroyNearFieldSlotTargets()
    for (let slot = 0; slot < NEAR_FIELD_SLOTS; slot += 1) {
      const texture = device.createTexture({
        width: finest.gridSize,
        height: finest.gridSize,
        format: 'rg32float',
        usage: Texture.SAMPLE | Texture.RENDER,
      })
      const fbo = device.createFramebuffer({
        width: finest.gridSize,
        height: finest.gridSize,
        colorAttachments: [texture],
        depthStencilAttachment: 'depth16unorm',
      })
      this.nearFieldSlotTargets.push({ texture, fbo })
    }
  }

  private destroyNearFieldSlotTargets (): void {
    for (const target of this.nearFieldSlotTargets) {
      if (!target.fbo.destroyed) target.fbo.destroy()
      if (!target.texture.destroyed) target.texture.destroy()
    }
    this.nearFieldSlotTargets = []
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
