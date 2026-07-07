import { Buffer, Framebuffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'

import calculateLevelFrag from '@/graph/modules/ForceManyBody/calculate-level.frag?raw'
import calculateLevelVert from '@/graph/modules/ForceManyBody/calculate-level.vert?raw'
import calculateLevel3DVert from '@/graph/modules/ForceManyBody/calculate-level-3d.vert?raw'
import forceFrag from '@/graph/modules/ForceManyBody/force-level.frag?raw'
import forceLevel3DFrag from '@/graph/modules/ForceManyBody/force-level-3d.frag?raw'
import forceCenterFrag from '@/graph/modules/ForceManyBody/force-centermass.frag?raw'
import forceNearField3DFrag from '@/graph/modules/ForceManyBody/force-nearfield-3d.frag?raw'
import buildNearFieldSlotsVert from '@/graph/modules/ForceManyBody/build-nearfield-slots.vert?raw'
import buildNearFieldSlotsFrag from '@/graph/modules/ForceManyBody/build-nearfield-slots.frag?raw'
import forceBruteForce3DFrag from '@/graph/modules/ForceManyBody/force-many-body-3d.frag?raw'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

/**
 * Point count at or below which 3D repulsion uses the exact O(n²) brute-force pass.
 * Above it, the octree approximation takes over (per-tick cost drops from O(n²)
 * to roughly O(n log n) at a small accuracy cost).
 */
const BRUTE_FORCE_3D_MAX_POINTS = 4096

/**
 * Finest octree grid resolution per axis (64³ tiles into a 512×512 texture).
 * Also bounds the near-field slot textures, which share the finest level's layout.
 */
const MAX_LEVEL_GRID_SIZE_3D = 64

/**
 * Depth-peeled points per finest-level cell that receive exact pairwise
 * repulsion each tick. The subset is re-randomized every tick, so points of a
 * dense cell rotate through exact treatment; the remainder acts through the
 * cell's residual centroid.
 */
const NEAR_FIELD_SLOTS_3D = 8

type LevelTarget = {
  texture: Texture;
  fbo: Framebuffer;
}

type LevelTarget3D = {
  texture: Texture;
  fbo: Framebuffer;
  /** Cells per axis of the 3D grid this level represents. */
  gridSize: number;
  /** z-slice tiles per texture row. */
  tilesPerRow: number;
  width: number;
  height: number;
}

export class ForceManyBody extends CoreModule {
  private randomValuesTexture: Texture | undefined
  private pointIndices: Buffer | undefined
  private levels = 0
  private levelTargets = new Map<number, LevelTarget>()
  /** Octree level count in 3D mode; `0` while the brute-force path is active. */
  private levels3D = 0
  private levelTargets3D = new Map<number, LevelTarget3D>()
  /**
   * Near-field point slots: NEAR_FIELD_SLOTS_3D textures sharing the finest
   * level's tiled layout, each holding [point index, hash] per cell — built by
   * depth peeling every tick (see build-nearfield-slots.vert).
   */
  private nearFieldSlotTargets: LevelTarget[] = []

  private calculateLevelsCommand: Model | undefined
  private forceCommand: Model | undefined
  private forceFromItsOwnCentermassCommand: Model | undefined
  /**
   * Exact O(n²) repulsion used in 3D mode for graphs up to
   * `BRUTE_FORCE_3D_MAX_POINTS` points (and as a fallback when the octree
   * targets are unavailable). Larger graphs use the octree passes below.
   */
  private bruteForce3DCommand: Model | undefined
  private calculateLevels3DCommand: Model | undefined
  private forceLevel3DCommand: Model | undefined
  private buildNearFieldSlotsCommand: Model | undefined
  private forceNearField3DCommand: Model | undefined

  private forceVertexCoordBuffer: Buffer | undefined

  private calculateLevelsUniformStore: UniformStore<{
    calculateLevelsUniforms: {
      pointsTextureSize: number;
      levelTextureSize: number;
      cellSize: number;
    };
  }> | undefined

  private forceUniformStore: UniformStore<{
    forceUniforms: {
      level: number;
      levels: number;
      levelTextureSize: number;
      alpha: number;
      repulsion: number;
      spaceSize: number;
      theta: number;
    };
  }> | undefined

  private forceCenterUniformStore: UniformStore<{
    forceCenterUniforms: {
      levelTextureSize: number;
      alpha: number;
      repulsion: number;
    };
  }> | undefined

  private bruteForce3DUniformStore: UniformStore<{
    forceBruteForceUniforms: {
      pointsTextureSize: number;
      pointsNumber: number;
      alpha: number;
      repulsion: number;
    };
  }> | undefined

  private calculateLevels3DUniformStore: UniformStore<{
    calculateLevels3DUniforms: {
      pointsTextureSize: number;
      levelGridSize: number;
      cellSize: number;
      tilesPerRow: number;
      levelTextureWidth: number;
      levelTextureHeight: number;
    };
  }> | undefined

  private forceLevel3DUniformStore: UniformStore<{
    forceLevel3DUniforms: {
      levelGridSize: number;
      cellSize: number;
      tilesPerRow: number;
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
      tilesPerRow: number;
      levelTextureWidth: number;
      levelTextureHeight: number;
      hasPreviousSlot: number;
      randomSeed: number;
    };
  }> | undefined

  private forceNearField3DUniformStore: UniformStore<{
    forceNearField3DUniforms: {
      pointsTextureSize: number;
      levelGridSize: number;
      cellSize: number;
      tilesPerRow: number;
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

    this.levels = Math.log2(store.adjustedSpaceSize)

    if (store.is3D) {
      // The 2D quadtree levels are not used in 3D — free them so a 2D → 3D switch
      // releases their GPU memory, and allocate the octree levels instead.
      for (const target of this.levelTargets.values()) {
        if (!target.fbo.destroyed) target.fbo.destroy()
        if (!target.texture.destroyed) target.texture.destroy()
      }
      this.levelTargets.clear()
      this.createLevels3D()
    } else {
      // Symmetrically, free the octree levels when returning to 2D.
      this.destroyLevelTargets3D()
      this.levels3D = 0
    }

    // Allocate quadtree levels (2D only)
    for (let level = 0; store.is3D === false && level < this.levels; level += 1) {
      const levelTextureSize = Math.pow(2, level + 1)
      const existingTarget = this.levelTargets.get(level)

      if (
        existingTarget &&
        existingTarget.texture.width === levelTextureSize &&
        existingTarget.texture.height === levelTextureSize
      ) {
        // Clear existing texture data to zero
        existingTarget.texture.copyImageData({
          data: new Float32Array(levelTextureSize * levelTextureSize * 4).fill(0),
          bytesPerRow: getBytesPerRow('rgba32float', levelTextureSize),
          mipLevel: 0,
          x: 0,
          y: 0,
        })
        continue
      }

      // Destroy old resources if size changed
      if (existingTarget) {
        if (!existingTarget.fbo.destroyed) existingTarget.fbo.destroy()
        if (!existingTarget.texture.destroyed) existingTarget.texture.destroy()
      }

      const texture = device.createTexture({
        width: levelTextureSize,
        height: levelTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      })
      texture.copyImageData({
        data: new Float32Array(levelTextureSize * levelTextureSize * 4).fill(0),
        bytesPerRow: getBytesPerRow('rgba32float', levelTextureSize),
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      const fbo = device.createFramebuffer({
        width: levelTextureSize,
        height: levelTextureSize,
        colorAttachments: [texture],
      })
      this.levelTargets.set(level, { texture, fbo })
    }

    // Drop any stale higher-level buffers if space size shrank
    for (const [level, target] of Array.from(this.levelTargets.entries())) {
      if (level >= this.levels) {
        if (!target.fbo.destroyed) target.fbo.destroy()
        if (!target.texture.destroyed) target.texture.destroy()
        this.levelTargets.delete(level)
      }
    }

    // Random jitter texture to prevent sticking (the blue channel is the z jitter,
    // consumed only in 3D mode)
    const totalPixels = store.pointsTextureSize * store.pointsTextureSize
    const randomValuesState = new Float32Array(totalPixels * 4)
    for (let i = 0; i < totalPixels; ++i) {
      randomValuesState[i * 4] = store.getRandomFloat(-1, 1) * 0.00001
      randomValuesState[i * 4 + 1] = store.getRandomFloat(-1, 1) * 0.00001
      randomValuesState[i * 4 + 2] = store.getRandomFloat(-1, 1) * 0.00001
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
      this.calculateLevels3DCommand?.setAttributes({
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

    // Calculate levels command (point list)
    this.calculateLevelsUniformStore ||= new UniformStore({
      calculateLevelsUniforms: {
        uniformTypes: {
          pointsTextureSize: 'f32',
          levelTextureSize: 'f32',
          cellSize: 'f32',
        },
        defaultUniforms: {
          pointsTextureSize: store.pointsTextureSize,
          levelTextureSize: 0,
          cellSize: 0,
        },
      },
    })

    this.calculateLevelsCommand ||= new Model(device, {
      fs: calculateLevelFrag,
      vs: calculateLevelVert,
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
        calculateLevelsUniforms: this.calculateLevelsUniformStore.getManagedUniformBuffer(device, 'calculateLevelsUniforms'),
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

    // Force command (fullscreen quad)
    this.forceUniformStore ||= new UniformStore({
      forceUniforms: {
        uniformTypes: {
          level: 'f32',
          levels: 'f32',
          levelTextureSize: 'f32',
          alpha: 'f32',
          repulsion: 'f32',
          spaceSize: 'f32',
          theta: 'f32',
        },
        defaultUniforms: {
          level: 0,
          levels: this.levels,
          levelTextureSize: 0,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
          spaceSize: store.adjustedSpaceSize,
          theta: this.config.simulationRepulsionTheta,
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
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        forceUniforms: this.forceUniformStore.getManagedUniformBuffer(device, 'forceUniforms'),
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

    // Force-from-centermass command (fullscreen quad)
    this.forceCenterUniformStore ||= new UniformStore({
      forceCenterUniforms: {
        uniformTypes: {
          levelTextureSize: 'f32',
          alpha: 'f32',
          repulsion: 'f32',
        },
        defaultUniforms: {
          levelTextureSize: 0,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
        },
      },
    })

    this.forceFromItsOwnCentermassCommand ||= new Model(device, {
      fs: forceCenterFrag,
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
        forceCenterUniforms: this.forceCenterUniformStore.getManagedUniformBuffer(device, 'forceCenterUniforms'),
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

    // Brute-force 3D repulsion command (fullscreen quad, 3D mode only)
    if (store.is3D) {
      this.bruteForce3DUniformStore ||= new UniformStore({
        forceBruteForceUniforms: {
          uniformTypes: {
            pointsTextureSize: 'f32',
            pointsNumber: 'f32',
            alpha: 'f32',
            repulsion: 'f32',
          },
          defaultUniforms: {
            pointsTextureSize: store.pointsTextureSize,
            pointsNumber: data.pointsNumber,
            alpha: store.alpha,
            repulsion: this.config.simulationRepulsion,
          },
        },
      })

      this.bruteForce3DCommand ||= new Model(device, {
        fs: forceBruteForce3DFrag,
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
          forceBruteForceUniforms: this.bruteForce3DUniformStore.getManagedUniformBuffer(device, 'forceBruteForceUniforms'),
          // All texture bindings will be set dynamically in drawForcesBruteForce3D() method
        },
        parameters: {
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      })

      // Octree aggregation command (point list, additive blend — mirrors calculateLevelsCommand)
      this.calculateLevels3DUniformStore ||= new UniformStore({
        calculateLevels3DUniforms: {
          uniformTypes: {
            // Order MUST match shader declaration order (std140 layout)
            pointsTextureSize: 'f32',
            levelGridSize: 'f32',
            cellSize: 'f32',
            tilesPerRow: 'f32',
            levelTextureWidth: 'f32',
            levelTextureHeight: 'f32',
          },
          defaultUniforms: {
            pointsTextureSize: store.pointsTextureSize,
            levelGridSize: 0,
            cellSize: 0,
            tilesPerRow: 0,
            levelTextureWidth: 0,
            levelTextureHeight: 0,
          },
        },
      })

      this.calculateLevels3DCommand ||= new Model(device, {
        fs: calculateLevelFrag,
        vs: calculateLevel3DVert,
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
          calculateLevels3DUniforms: this.calculateLevels3DUniformStore.getManagedUniformBuffer(device, 'calculateLevels3DUniforms'),
          // All texture bindings will be set dynamically in drawLevels3D() method
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

      // Octree per-level force command (fullscreen quad, additive into velocityFbo)
      this.forceLevel3DUniformStore ||= new UniformStore({
        forceLevel3DUniforms: {
          uniformTypes: {
            // Order MUST match shader declaration order (std140 layout)
            levelGridSize: 'f32',
            cellSize: 'f32',
            tilesPerRow: 'f32',
            isFirstLevel: 'f32',
            alpha: 'f32',
            repulsion: 'f32',
          },
          defaultUniforms: {
            levelGridSize: 0,
            cellSize: 0,
            tilesPerRow: 0,
            isFirstLevel: 0,
            alpha: store.alpha,
            repulsion: this.config.simulationRepulsion,
          },
        },
      })

      this.forceLevel3DCommand ||= new Model(device, {
        fs: forceLevel3DFrag,
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
          forceLevel3DUniforms: this.forceLevel3DUniformStore.getManagedUniformBuffer(device, 'forceLevel3DUniforms'),
          // All texture bindings will be set dynamically in drawForcesOctree3D() method
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
      this.buildNearFieldSlotsUniformStore ||= new UniformStore({
        buildNearFieldSlotsUniforms: {
          uniformTypes: {
            // Order MUST match shader declaration order (std140 layout)
            pointsTextureSize: 'f32',
            levelGridSize: 'f32',
            cellSize: 'f32',
            tilesPerRow: 'f32',
            levelTextureWidth: 'f32',
            levelTextureHeight: 'f32',
            hasPreviousSlot: 'f32',
            randomSeed: 'f32',
          },
          defaultUniforms: {
            pointsTextureSize: store.pointsTextureSize,
            levelGridSize: 0,
            cellSize: 0,
            tilesPerRow: 0,
            levelTextureWidth: 0,
            levelTextureHeight: 0,
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
          buildNearFieldSlotsUniforms: this.buildNearFieldSlotsUniformStore.getManagedUniformBuffer(device, 'buildNearFieldSlotsUniforms'),
          // All texture bindings will be set dynamically in drawNearFieldSlots() method
        },
        parameters: {
          blend: false,
          depthWriteEnabled: true,
          depthCompare: 'less',
        },
      })

      // Octree near-field force command (fullscreen quad — the P3M replacement of
      // the 2D forceFromItsOwnCentermassCommand)
      this.forceNearField3DUniformStore ||= new UniformStore({
        forceNearField3DUniforms: {
          uniformTypes: {
            // Order MUST match shader declaration order (std140 layout)
            pointsTextureSize: 'f32',
            levelGridSize: 'f32',
            cellSize: 'f32',
            tilesPerRow: 'f32',
            alpha: 'f32',
            repulsion: 'f32',
          },
          defaultUniforms: {
            pointsTextureSize: store.pointsTextureSize,
            levelGridSize: 0,
            cellSize: 0,
            tilesPerRow: 0,
            alpha: store.alpha,
            repulsion: this.config.simulationRepulsion,
          },
        },
      })

      this.forceNearField3DCommand ||= new Model(device, {
        fs: forceNearField3DFrag,
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
          forceNearField3DUniforms: this.forceNearField3DUniformStore.getManagedUniformBuffer(device, 'forceNearField3DUniforms'),
          // All texture bindings will be set dynamically in drawForcesOctree3D() method
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
    if (this.store.is3D) {
      // Octree above the threshold; exact brute force below (and as a defensive
      // fallback when the octree or near-field targets are unavailable).
      const pointsNumber = this.data.pointsNumber ?? 0
      if (
        pointsNumber > BRUTE_FORCE_3D_MAX_POINTS &&
        this.levelTargets3D.size > 0 &&
        this.nearFieldSlotTargets.length === NEAR_FIELD_SLOTS_3D
      ) {
        this.drawLevels3D()
        this.drawNearFieldSlots()
        this.drawForcesOctree3D()
      } else {
        this.drawForcesBruteForce3D()
      }
    } else {
      this.drawLevels()
      this.drawForces()
    }
  }

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   */
  public destroy (): void {
    // 1. Destroy Models FIRST (they destroy _gpuGeometry if exists, and _uniformStore)
    this.calculateLevelsCommand?.destroy()
    this.calculateLevelsCommand = undefined
    this.forceCommand?.destroy()
    this.forceCommand = undefined
    this.forceFromItsOwnCentermassCommand?.destroy()
    this.forceFromItsOwnCentermassCommand = undefined
    this.bruteForce3DCommand?.destroy()
    this.bruteForce3DCommand = undefined
    this.calculateLevels3DCommand?.destroy()
    this.calculateLevels3DCommand = undefined
    this.forceLevel3DCommand?.destroy()
    this.forceLevel3DCommand = undefined
    this.buildNearFieldSlotsCommand?.destroy()
    this.buildNearFieldSlotsCommand = undefined
    this.forceNearField3DCommand?.destroy()
    this.forceNearField3DCommand = undefined

    // 2. Destroy Framebuffers (before textures they reference)
    for (const target of this.levelTargets.values()) {
      if (target.fbo && !target.fbo.destroyed) {
        target.fbo.destroy()
      }
    }

    // 3. Destroy Textures
    if (this.randomValuesTexture && !this.randomValuesTexture.destroyed) {
      this.randomValuesTexture.destroy()
    }
    this.randomValuesTexture = undefined

    for (const target of this.levelTargets.values()) {
      if (target.texture && !target.texture.destroyed) {
        target.texture.destroy()
      }
    }
    this.levelTargets.clear()

    // Octree targets destroy their FBOs before their textures internally
    this.destroyLevelTargets3D()

    // 4. Destroy UniformStores (Models already destroyed their managed uniform buffers)
    this.calculateLevelsUniformStore?.destroy()
    this.calculateLevelsUniformStore = undefined
    this.forceUniformStore?.destroy()
    this.forceUniformStore = undefined
    this.forceCenterUniformStore?.destroy()
    this.forceCenterUniformStore = undefined
    this.bruteForce3DUniformStore?.destroy()
    this.bruteForce3DUniformStore = undefined
    this.calculateLevels3DUniformStore?.destroy()
    this.calculateLevels3DUniformStore = undefined
    this.forceLevel3DUniformStore?.destroy()
    this.forceLevel3DUniformStore = undefined
    this.buildNearFieldSlotsUniformStore?.destroy()
    this.buildNearFieldSlotsUniformStore = undefined
    this.forceNearField3DUniformStore?.destroy()
    this.forceNearField3DUniformStore = undefined

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

  private drawForcesBruteForce3D (): void {
    const { device, store, data, points } = this
    if (!points) return
    if (!this.bruteForce3DCommand || !this.bruteForce3DUniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!this.randomValuesTexture || this.randomValuesTexture.destroyed) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return

    this.bruteForce3DUniformStore.setUniforms({
      forceBruteForceUniforms: {
        pointsTextureSize: store.pointsTextureSize ?? 0,
        pointsNumber: data.pointsNumber ?? 0,
        alpha: store.alpha,
        repulsion: this.config.simulationRepulsion,
      },
    })

    // Update texture bindings dynamically
    this.bruteForce3DCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      randomValues: this.randomValuesTexture,
    })

    const drawPass = device.beginRenderPass({
      framebuffer: points.velocityFbo,
      clearColor: [0, 0, 0, 0],
    })
    this.bruteForce3DCommand.draw(drawPass)
    drawPass.end()
  }

  /** Aggregates points into every octree level texture (mirrors drawLevels). */
  private drawLevels3D (): void {
    const { device, store, data, points } = this
    if (!points) return
    if (!this.calculateLevels3DCommand || !this.calculateLevels3DUniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!data.pointsNumber) return
    // Ensure pointIndices is set (Model might exist but attributes not set yet)
    if (!this.pointIndices) return

    for (let level = 0; level < this.levels3D; level += 1) {
      const target = this.levelTargets3D.get(level)
      if (!target || target.fbo.destroyed || target.texture.destroyed) continue

      this.calculateLevels3DUniformStore.setUniforms({
        calculateLevels3DUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          levelGridSize: target.gridSize,
          // Computed per level from the space size so the power-of-two halving
          // chain stays bit-exact between levels (the coverage invariant relies on it).
          cellSize: store.adjustedSpaceSize / target.gridSize,
          tilesPerRow: target.tilesPerRow,
          levelTextureWidth: target.width,
          levelTextureHeight: target.height,
        },
      })

      // Unused points-texture pixels must not aggregate phantom mass into cell (0,0,0)
      this.calculateLevels3DCommand.setVertexCount(data.pointsNumber)
      // Update texture bindings dynamically
      this.calculateLevels3DCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
      })

      const levelPass = device.beginRenderPass({
        framebuffer: target.fbo,
        clearColor: [0, 0, 0, 0],
      })
      this.calculateLevels3DCommand.draw(levelPass)
      levelPass.end()
    }
  }

  /**
   * Octree repulsion: one additive pass per level into the velocity FBO, then the
   * near-field pass reading the finest level (mirrors drawForces + the centermass fallback).
   */
  private drawForcesOctree3D (): void {
    const { device, store, points } = this
    if (!points) return
    if (!this.forceLevel3DCommand || !this.forceLevel3DUniformStore) return
    if (!this.forceNearField3DCommand || !this.forceNearField3DUniformStore) return
    if (this.nearFieldSlotTargets.length !== NEAR_FIELD_SLOTS_3D) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!this.randomValuesTexture || this.randomValuesTexture.destroyed) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return

    const drawPass = device.beginRenderPass({
      framebuffer: points.velocityFbo,
      clearColor: [0, 0, 0, 0],
    })

    for (let level = 0; level < this.levels3D; level += 1) {
      const target = this.levelTargets3D.get(level)
      if (!target || target.texture.destroyed) continue
      const cellSize = store.adjustedSpaceSize / target.gridSize

      this.forceLevel3DUniformStore.setUniforms({
        forceLevel3DUniforms: {
          levelGridSize: target.gridSize,
          cellSize,
          tilesPerRow: target.tilesPerRow,
          isFirstLevel: level === 0 ? 1 : 0,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
        },
      })

      // Update texture bindings dynamically
      this.forceLevel3DCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        levelTexture: target.texture,
      })
      this.forceLevel3DCommand.draw(drawPass)

      // The finest level leaves only the 3³ neighborhood uncovered — the near-field
      // pass closes it with importance-weighted pairwise forces from the
      // depth-peeled slot points (unbiased Monte-Carlo of the all-pairs sum).
      if (level === this.levels3D - 1) {
        this.forceNearField3DUniformStore.setUniforms({
          forceNearField3DUniforms: {
            pointsTextureSize: store.pointsTextureSize ?? 0,
            levelGridSize: target.gridSize,
            cellSize,
            tilesPerRow: target.tilesPerRow,
            alpha: store.alpha,
            repulsion: this.config.simulationRepulsion,
          },
        })

        this.forceNearField3DCommand.setBindings({
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
        this.forceNearField3DCommand.draw(drawPass)
      }
    }

    drawPass.end()
  }

  /**
   * Rebuilds the near-field point slots for this tick: NEAR_FIELD_SLOTS_3D
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
    if (!data.pointsNumber || !this.pointIndices) return
    const finest = this.levelTargets3D.get(this.levels3D - 1)
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
          tilesPerRow: finest.tilesPerRow,
          levelTextureWidth: finest.width,
          levelTextureHeight: finest.height,
          hasPreviousSlot: slot === 0 ? 0 : 1,
          // The seed is shared by all slots of one tick — peeling relies on a
          // consistent hash ordering across the passes.
          randomSeed,
        },
      })

      this.buildNearFieldSlotsCommand.setVertexCount(data.pointsNumber)
      this.buildNearFieldSlotsCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
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
   * Allocates the octree level pyramid: 3D grids of 4³, 8³, … up to an adaptive
   * finest resolution (~2·∛n cells per axis, capped at MAX_LEVEL_GRID_SIZE_3D),
   * each flattened into a 2D texture of tiled z-slices. Below the brute-force
   * threshold the octree is not used, so no targets are kept.
   * Textures are not zero-filled here — drawLevels3D clears them every tick.
   */
  private createLevels3D (): void {
    const { device } = this
    const pointsNumber = this.data.pointsNumber ?? 0
    if (pointsNumber <= BRUTE_FORCE_3D_MAX_POINTS) {
      this.destroyLevelTargets3D()
      this.levels3D = 0
      return
    }

    const targetGridSize = 2 * Math.cbrt(pointsNumber)
    const finestGridSize = Math.min(
      MAX_LEVEL_GRID_SIZE_3D,
      Math.max(8, Math.pow(2, Math.ceil(Math.log2(targetGridSize))))
    )
    this.levels3D = Math.log2(finestGridSize) - 1

    for (let level = 0; level < this.levels3D; level += 1) {
      const gridSize = Math.pow(2, level + 2)
      const tilesPerRow = Math.ceil(Math.sqrt(gridSize))
      const width = gridSize * tilesPerRow
      const height = gridSize * Math.ceil(gridSize / tilesPerRow)

      const existingTarget = this.levelTargets3D.get(level)
      if (existingTarget && existingTarget.width === width && existingTarget.height === height) continue
      if (existingTarget) {
        if (!existingTarget.fbo.destroyed) existingTarget.fbo.destroy()
        if (!existingTarget.texture.destroyed) existingTarget.texture.destroy()
      }

      const texture = device.createTexture({
        width,
        height,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER,
      })
      const fbo = device.createFramebuffer({
        width,
        height,
        colorAttachments: [texture],
      })
      this.levelTargets3D.set(level, { texture, fbo, gridSize, tilesPerRow, width, height })
    }

    // Drop stale finer levels if the pyramid shrank
    for (const [level, target] of Array.from(this.levelTargets3D.entries())) {
      if (level >= this.levels3D) {
        if (!target.fbo.destroyed) target.fbo.destroy()
        if (!target.texture.destroyed) target.texture.destroy()
        this.levelTargets3D.delete(level)
      }
    }

    // Near-field slot textures share the finest level's tiled layout
    const finest = this.levelTargets3D.get(this.levels3D - 1)
    if (finest) this.createNearFieldSlotTargets(finest)
  }

  /**
   * Allocates the depth-peeling slot targets ([point index, hash] per cell) plus
   * a depth attachment each for the peel's smallest-hash selection.
   */
  private createNearFieldSlotTargets (finest: LevelTarget3D): void {
    const { device } = this
    const existing = this.nearFieldSlotTargets[0]
    if (
      existing &&
      !existing.texture.destroyed &&
      existing.texture.width === finest.width &&
      existing.texture.height === finest.height &&
      this.nearFieldSlotTargets.length === NEAR_FIELD_SLOTS_3D
    ) return

    this.destroyNearFieldSlotTargets()
    for (let slot = 0; slot < NEAR_FIELD_SLOTS_3D; slot += 1) {
      const texture = device.createTexture({
        width: finest.width,
        height: finest.height,
        format: 'rg32float',
        usage: Texture.SAMPLE | Texture.RENDER,
      })
      const fbo = device.createFramebuffer({
        width: finest.width,
        height: finest.height,
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

  private destroyLevelTargets3D (): void {
    for (const target of this.levelTargets3D.values()) {
      if (!target.fbo.destroyed) target.fbo.destroy()
      if (!target.texture.destroyed) target.texture.destroy()
    }
    this.levelTargets3D.clear()
    this.destroyNearFieldSlotTargets()
  }

  private drawLevels (): void {
    const { device, store, data, points } = this
    if (!points) return
    if (!this.calculateLevelsCommand || !this.calculateLevelsUniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!data.pointsNumber) return
    // Ensure pointIndices is set (Model might exist but attributes not set yet)
    if (!this.pointIndices) return

    for (let level = 0; level < this.levels; level += 1) {
      const target = this.levelTargets.get(level)
      if (!target || target.fbo.destroyed || target.texture.destroyed) continue

      const levelTextureSize = Math.pow(2, level + 1)
      const cellSize = store.adjustedSpaceSize / levelTextureSize

      this.calculateLevelsUniformStore.setUniforms({
        calculateLevelsUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          levelTextureSize,
          cellSize,
        },
      })

      this.calculateLevelsCommand.setVertexCount(data.pointsNumber)
      // Update texture bindings dynamically
      this.calculateLevelsCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
      })

      const levelPass = device.beginRenderPass({
        framebuffer: target.fbo,
        clearColor: [0, 0, 0, 0],
      })

      this.calculateLevelsCommand.draw(levelPass)

      levelPass.end()
    }
  }

  private drawForces (): void {
    const { device, store, points } = this
    if (!points) return
    if (!this.forceCommand || !this.forceUniformStore) return
    if (!this.forceFromItsOwnCentermassCommand || !this.forceCenterUniformStore) return
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
      const levelTextureSize = Math.pow(2, level + 1)

      this.forceUniformStore.setUniforms({
        forceUniforms: {
          level,
          levels: this.levels,
          levelTextureSize,
          alpha: store.alpha,
          repulsion: this.config.simulationRepulsion,
          spaceSize: store.adjustedSpaceSize,
          theta: this.config.simulationRepulsionTheta,
        },
      })

      // Update texture bindings dynamically
      this.forceCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        levelFbo: target.texture,
      })

      this.forceCommand.draw(drawPass)

      // Only the deepest level uses the centermass fallback
      if (level === this.levels - 1) {
        this.forceCenterUniformStore.setUniforms({
          forceCenterUniforms: {
            levelTextureSize,
            alpha: store.alpha,
            repulsion: this.config.simulationRepulsion,
          },
        })

        // Update texture bindings dynamically
        this.forceFromItsOwnCentermassCommand.setBindings({
          positionsTexture: points.previousPositionTexture,
          randomValues: this.randomValuesTexture,
          levelFbo: target.texture,
        })
        this.forceFromItsOwnCentermassCommand.draw(drawPass)
      }
    }

    drawPass.end()
  }
}
