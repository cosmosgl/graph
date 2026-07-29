import { Buffer, Framebuffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import { readPixels } from '@/graph/helper'

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
import reduceSumFrag from '@/graph/modules/ForceManyBody/reduce-sum.frag?raw'
import reduceEmaFrag from '@/graph/modules/ForceManyBody/reduce-ema.frag?raw'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import { getUmapABParams } from '@/graph/modules/Shared/umap-params'
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

/**
 * Weight of the current raw Z in the t-SNE normalization's exponential moving
 * average (Z_smooth = mix(prev, raw, α)). Small → Z drifts toward its true
 * value over several ticks, damping the delayed-feedback oscillation that
 * otherwise flings the layout to the space walls before it relaxes. See
 * reduce-ema.frag.
 */
const Z_EMA_ALPHA = 0.1

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
      umapA: number;
      umapB: number;
      umapScale: number;
    };
  }> | undefined

  private forceCenterUniformStore: UniformStore<{
    forceCenterUniforms: {
      levelTextureSize: number;
      alpha: number;
      repulsion: number;
      umapA: number;
      umapB: number;
      umapScale: number;
    };
  }> | undefined

  private bruteForce3DUniformStore: UniformStore<{
    forceBruteForceUniforms: {
      pointsTextureSize: number;
      pointsNumber: number;
      alpha: number;
      repulsion: number;
      umapA: number;
      umapB: number;
      umapScale: number;
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
      umapA: number;
      umapB: number;
      umapScale: number;
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
      umapA: number;
      umapB: number;
      umapScale: number;
    };
  }> | undefined

  /**
   * t-SNE global-normalization (Z) reduction chain: textures halving in size
   * from ceil(pointsTextureSize / 2) down to 1×1. The repulsion passes write
   * per-point partial sums into the velocity texture's alpha channel; the chain
   * sums them, and the final 1×1 texture is read (one tick lagged) by the
   * repulsion shaders' TSNE_KERNEL branch.
   */
  private zReduceTargets: LevelTarget[] = []
  private zReduceCommand: Model | undefined
  private zReduceUniformStore: UniformStore<{
    reduceSumUniforms: {
      inputWidth: number;
      inputHeight: number;
      readAlpha: number;
    };
  }> | undefined

  /**
   * Ping-ponged 1×1 targets holding the exponential moving average of Z, and
   * the index of the current (front) one. The raw reduction result rings from
   * the one-tick-lagged repulsion feedback; the EMA damps it before repulsion
   * consumes it. See reduce-ema.frag.
   */
  private zSmoothTargets: LevelTarget[] = []
  private zSmoothIndex = 0
  private zEmaCommand: Model | undefined
  private zEmaUniformStore: UniformStore<{
    reduceEmaUniforms: { emaAlpha: number };
  }> | undefined

  private previousPointsTextureSize: number | undefined
  private previousSpaceSize: number | undefined
  private previousPointsNumber: number | undefined
  /** Force kernel the Models were compiled for; a kernel switch recreates them (UMAP/TSNE_KERNEL define). */
  private programsKernel: 'default' | 'umap' | 'tsne' = 'default'

  /**
   * Kernel selector baked into the repulsion shaders. The kernel parameters
   * themselves (a, b, scale) are uniforms — see umapKernelUniforms — so only a
   * kernel switch requires recompiling.
   */
  private get umapKernelDefines (): Record<string, boolean> {
    if (this.config.simulationKernel === 'umap') return { UMAP_KERNEL: true }
    if (this.config.simulationKernel === 'tsne') return { TSNE_KERNEL: true }
    return {}
  }

  /**
   * Per-tick UMAP kernel uniform values: a, b fit from min_dist / spread
   * (memoized — see Shared/umap-params.ts); umapScale converts space units to
   * embedding units. Harmless defaults in the default kernel (unused there).
   */
  private get umapKernelUniforms (): { umapA: number; umapB: number; umapScale: number } {
    const { a, b } = getUmapABParams(this.config.simulationUmapMinDist, this.config.simulationUmapSpread)
    return { umapA: a, umapB: b, umapScale: this.config.simulationUmapScale }
  }

  /**
   * Repulsion coefficient handed to the shaders. In UMAP mode the many-body
   * pass aggregates repulsion from ALL points each tick, while reference UMAP
   * only draws a handful of negative samples per point per epoch — so the
   * config value is normalized by the point count, making `simulationRepulsion`
   * an O(1) knob (≈ negative samples per point) instead of requiring users to
   * hand-tune ≈ samples / n.
   */
  private get effectiveRepulsion (): number {
    const n = Math.max(1, this.data.pointsNumber ?? 1)
    // UMAP: aggregated all-pairs repulsion vs reference negative sampling → ÷ n.
    if (this.config.simulationKernel === 'umap') return this.config.simulationRepulsion / n
    // t-SNE: p_ij sums to 1 over the graph, so gradients are O(1/n) — scale both
    // terms by n (the attractive side does the same in force-spring.ts) so the
    // config knobs stay O(1).
    if (this.config.simulationKernel === 'tsne') return this.config.simulationRepulsion * n
    return this.config.simulationRepulsion
  }

  /**
   * Alpha handed to the repulsion shaders. The t-SNE kernel has no annealing —
   * its own optimizer (momentum + per-point gains) provides convergence — so its
   * gradient is never scaled down by alpha decay.
   */
  private get effectiveAlpha (): number {
    return this.config.simulationKernel === 'tsne' ? 1 : this.store.alpha
  }

  /** Raw 1×1 output of the Z reduction chain (last tick's Z), if any. */
  private get zRawTexture (): Texture | undefined {
    return this.zReduceTargets[this.zReduceTargets.length - 1]?.texture
  }

  /**
   * Z value the repulsion shaders consume: the EMA-smoothed Z when the damping
   * targets are up (the normal t-SNE path), falling back to the raw reduction
   * output otherwise.
   */
  private get zFinalTexture (): Texture | undefined {
    return this.zSmoothTargets[this.zSmoothIndex]?.texture ?? this.zRawTexture
  }

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

      // Textures are not zero-filled here — drawLevels clears every level FBO
      // each tick before aggregating (a CPU zero-fill would allocate and upload
      // hundreds of MB per data update for the deeper levels).
      if (
        existingTarget &&
        existingTarget.texture.width === levelTextureSize &&
        existingTarget.texture.height === levelTextureSize
      ) {
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
        usage: Texture.SAMPLE | Texture.RENDER,
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

    this.createZReduceTargets()

    this.previousPointsTextureSize = store.pointsTextureSize
    this.previousSpaceSize = store.adjustedSpaceSize
    this.previousPointsNumber = this.data.pointsNumber
  }

  public initPrograms (): void {
    const { device, store, data, points } = this
    if (!data.pointsNumber || !points || !store.pointsTextureSize) return

    // Only a kernel switch recompiles the force Models (UMAP_KERNEL define) —
    // the kernel parameters are uniforms. Aggregation passes are unaffected.
    const kernel = this.config.simulationKernel
    if (this.programsKernel !== kernel) {
      this.programsKernel = kernel
      this.forceCommand?.destroy()
      this.forceCommand = undefined
      this.forceFromItsOwnCentermassCommand?.destroy()
      this.forceFromItsOwnCentermassCommand = undefined
      this.bruteForce3DCommand?.destroy()
      this.bruteForce3DCommand = undefined
      this.forceLevel3DCommand?.destroy()
      this.forceLevel3DCommand = undefined
      this.forceNearField3DCommand?.destroy()
      this.forceNearField3DCommand = undefined
    }

    // Calculate levels command (point list)
    this.calculateLevelsUniformStore ||= new UniformStore(device, {
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
        ...this.umapKernelDefines,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        calculateLevelsUniforms: this.calculateLevelsUniformStore.getManagedUniformBuffer('calculateLevelsUniforms'),
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
    this.forceUniformStore ||= new UniformStore(device, {
      forceUniforms: {
        uniformTypes: {
          level: 'f32',
          levels: 'f32',
          levelTextureSize: 'f32',
          alpha: 'f32',
          repulsion: 'f32',
          spaceSize: 'f32',
          theta: 'f32',
          umapA: 'f32',
          umapB: 'f32',
          umapScale: 'f32',
        },
        defaultUniforms: {
          level: 0,
          levels: this.levels,
          levelTextureSize: 0,
          alpha: this.effectiveAlpha,
          repulsion: this.effectiveRepulsion,
          spaceSize: store.adjustedSpaceSize,
          theta: this.config.simulationRepulsionTheta,
          ...this.umapKernelUniforms,
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
        ...this.umapKernelDefines,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        forceUniforms: this.forceUniformStore.getManagedUniformBuffer('forceUniforms'),
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
    this.forceCenterUniformStore ||= new UniformStore(device, {
      forceCenterUniforms: {
        uniformTypes: {
          levelTextureSize: 'f32',
          alpha: 'f32',
          repulsion: 'f32',
          umapA: 'f32',
          umapB: 'f32',
          umapScale: 'f32',
        },
        defaultUniforms: {
          levelTextureSize: 0,
          alpha: this.effectiveAlpha,
          repulsion: this.effectiveRepulsion,
          ...this.umapKernelUniforms,
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
        ...this.umapKernelDefines,
      },
      bindings: {
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        forceCenterUniforms: this.forceCenterUniformStore.getManagedUniformBuffer('forceCenterUniforms'),
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
      this.bruteForce3DUniformStore ||= new UniformStore(device, {
        forceBruteForceUniforms: {
          uniformTypes: {
            pointsTextureSize: 'f32',
            pointsNumber: 'f32',
            alpha: 'f32',
            repulsion: 'f32',
            umapA: 'f32',
            umapB: 'f32',
            umapScale: 'f32',
          },
          defaultUniforms: {
            pointsTextureSize: store.pointsTextureSize,
            pointsNumber: data.pointsNumber,
            alpha: this.effectiveAlpha,
            repulsion: this.effectiveRepulsion,
            ...this.umapKernelUniforms,
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
          ...this.umapKernelDefines,
        },
        bindings: {
          forceBruteForceUniforms: this.bruteForce3DUniformStore.getManagedUniformBuffer('forceBruteForceUniforms'),
          // All texture bindings will be set dynamically in drawForcesBruteForce3D() method
        },
        parameters: {
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      })

      // Octree aggregation command (point list, additive blend — mirrors calculateLevelsCommand)
      this.calculateLevels3DUniformStore ||= new UniformStore(device, {
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
          ...this.umapKernelDefines,
        },
        bindings: {
          calculateLevels3DUniforms: this.calculateLevels3DUniformStore.getManagedUniformBuffer('calculateLevels3DUniforms'),
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
      this.forceLevel3DUniformStore ||= new UniformStore(device, {
        forceLevel3DUniforms: {
          uniformTypes: {
            // Order MUST match shader declaration order (std140 layout)
            levelGridSize: 'f32',
            cellSize: 'f32',
            tilesPerRow: 'f32',
            isFirstLevel: 'f32',
            alpha: 'f32',
            repulsion: 'f32',
            umapA: 'f32',
            umapB: 'f32',
            umapScale: 'f32',
          },
          defaultUniforms: {
            levelGridSize: 0,
            cellSize: 0,
            tilesPerRow: 0,
            isFirstLevel: 0,
            alpha: this.effectiveAlpha,
            repulsion: this.effectiveRepulsion,
            ...this.umapKernelUniforms,
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
          ...this.umapKernelDefines,
        },
        bindings: {
          forceLevel3DUniforms: this.forceLevel3DUniformStore.getManagedUniformBuffer('forceLevel3DUniforms'),
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
      this.buildNearFieldSlotsUniformStore ||= new UniformStore(device, {
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
          ...this.umapKernelDefines,
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

      // Octree near-field force command (fullscreen quad — the P3M replacement of
      // the 2D forceFromItsOwnCentermassCommand)
      this.forceNearField3DUniformStore ||= new UniformStore(device, {
        forceNearField3DUniforms: {
          uniformTypes: {
            // Order MUST match shader declaration order (std140 layout)
            pointsTextureSize: 'f32',
            levelGridSize: 'f32',
            cellSize: 'f32',
            tilesPerRow: 'f32',
            alpha: 'f32',
            repulsion: 'f32',
            umapA: 'f32',
            umapB: 'f32',
            umapScale: 'f32',
          },
          defaultUniforms: {
            pointsTextureSize: store.pointsTextureSize,
            levelGridSize: 0,
            cellSize: 0,
            tilesPerRow: 0,
            alpha: this.effectiveAlpha,
            repulsion: this.effectiveRepulsion,
            ...this.umapKernelUniforms,
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
          ...this.umapKernelDefines,
        },
        bindings: {
          forceNearField3DUniforms: this.forceNearField3DUniformStore.getManagedUniformBuffer('forceNearField3DUniforms'),
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

    // t-SNE Z reduction command (fullscreen quad, no blending — each step
    // overwrites its own target).
    if (kernel === 'tsne') {
      this.zReduceUniformStore ||= new UniformStore(device, {
        reduceSumUniforms: {
          uniformTypes: {
            inputWidth: 'f32',
            inputHeight: 'f32',
            readAlpha: 'f32',
          },
        },
      })

      this.zReduceCommand ||= new Model(device, {
        fs: reduceSumFrag,
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
          reduceSumUniforms: this.zReduceUniformStore.getManagedUniformBuffer('reduceSumUniforms'),
          // reduceInput is bound per step in reduceZ()
        },
        parameters: {
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      })

      // t-SNE Z damping command: EMA-smooths the 1×1 raw Z before repulsion
      // reads it (see reduce-ema.frag). rawInput / prevInput bound per tick.
      this.zEmaUniformStore ||= new UniformStore(device, {
        reduceEmaUniforms: {
          uniformTypes: { emaAlpha: 'f32' },
        },
      })

      this.zEmaCommand ||= new Model(device, {
        fs: reduceEmaFrag,
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
          reduceEmaUniforms: this.zEmaUniformStore.getManagedUniformBuffer('reduceEmaUniforms'),
        },
        parameters: {
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      })
    }
  }

  /**
   * Reads back the current t-SNE global normalization Z — the raw 1×1 result of
   * the reduction chain (NOT the EMA-smoothed value repulsion consumes), so the
   * validation story keeps measuring the reduction itself. Synchronous GPU read
   * — meant for debugging / validation, not per-frame use. Returns `undefined`
   * outside the t-SNE kernel.
   */
  public readZ (): number | undefined {
    const finalTarget = this.zReduceTargets[this.zReduceTargets.length - 1]
    if (!finalTarget || finalTarget.fbo.destroyed) return undefined
    const pixels = readPixels(this.device, finalTarget.fbo as Framebuffer)
    return pixels[0]
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
    // A live switch to the t-SNE kernel reaches run() without create(): build
    // the Z reduction chain lazily.
    if (this.config.simulationKernel === 'tsne' && this.zReduceTargets.length === 0) {
      this.createZReduceTargets()
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
    // t-SNE: the repulsion passes above accumulated the per-point Z partial sums
    // into the velocity texture's alpha channel — reduce them to the 1×1 Z for
    // the next tick (one-tick lag; the forces just drawn used last tick's Z).
    if (this.config.simulationKernel === 'tsne') this.reduceZ()
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
    this.zReduceCommand?.destroy()
    this.zReduceCommand = undefined
    this.zEmaCommand?.destroy()
    this.zEmaCommand = undefined

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
    this.destroyZReduceTargets()

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
    this.zReduceUniformStore?.destroy()
    this.zReduceUniformStore = undefined
    this.zEmaUniformStore?.destroy()
    this.zEmaUniformStore = undefined

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
   * Allocates the Z reduction chain (t-SNE kernel only): textures halving from
   * ceil(pointsTextureSize / 2) down to 1×1, and seeds the final target with a
   * safe first-tick Z. A compact initial cloud has w ≈ 1 per pair, so n²
   * over-estimates Z — the first tick's repulsion errs weak, never explosive.
   */
  private createZReduceTargets (): void {
    const { device, store } = this
    const pointsTextureSize = store.pointsTextureSize
    if (this.config.simulationKernel !== 'tsne' || !pointsTextureSize) {
      this.destroyZReduceTargets()
      return
    }

    const sizes: number[] = []
    let size = Math.max(1, Math.ceil(pointsTextureSize / 2))
    for (;;) {
      sizes.push(size)
      if (size === 1) break
      size = Math.ceil(size / 2)
    }
    const upToDate = this.zReduceTargets.length === sizes.length &&
      this.zReduceTargets.every((target, i) => !target.texture.destroyed && target.texture.width === sizes[i])
    if (!upToDate) {
      this.destroyZReduceTargets()
      for (const s of sizes) {
        const texture = device.createTexture({
          width: s,
          height: s,
          format: 'rgba32float',
          usage: Texture.SAMPLE | Texture.RENDER,
        })
        const fbo = device.createFramebuffer({ width: s, height: s, colorAttachments: [texture] })
        this.zReduceTargets.push({ texture, fbo })
      }
    }

    // Two 1×1 ping-pong targets for the EMA-smoothed Z.
    const smoothUpToDate = this.zSmoothTargets.length === 2 &&
      this.zSmoothTargets.every((target) => !target.texture.destroyed)
    if (!smoothUpToDate) {
      this.destroyZSmoothTargets()
      for (let i = 0; i < 2; i++) {
        const texture = device.createTexture({
          width: 1,
          height: 1,
          format: 'rgba32float',
          usage: Texture.SAMPLE | Texture.RENDER,
        })
        const fbo = device.createFramebuffer({ width: 1, height: 1, colorAttachments: [texture] })
        this.zSmoothTargets.push({ texture, fbo })
      }
    }
    this.zSmoothIndex = 0

    // Seed the raw and both smoothed targets with n². A compact initial cloud
    // has w ≈ 1 per pair, so n² over-estimates Z — the first tick's repulsion
    // errs weak, never explosive.
    const n = this.data.pointsNumber ?? 1
    const seed: [number, number, number, number] = [n * n, 0, 0, 0]
    const finalTarget = this.zReduceTargets[this.zReduceTargets.length - 1]
    for (const target of [finalTarget, ...this.zSmoothTargets]) {
      if (target && !target.fbo.destroyed) {
        device.beginRenderPass({ framebuffer: target.fbo, clearColor: seed }).end()
      }
    }
  }

  private destroyZReduceTargets (): void {
    for (const target of this.zReduceTargets) {
      if (!target.fbo.destroyed) target.fbo.destroy()
      if (!target.texture.destroyed) target.texture.destroy()
    }
    this.zReduceTargets = []
    this.destroyZSmoothTargets()
  }

  private destroyZSmoothTargets (): void {
    for (const target of this.zSmoothTargets) {
      if (!target.fbo.destroyed) target.fbo.destroy()
      if (!target.texture.destroyed) target.texture.destroy()
    }
    this.zSmoothTargets = []
  }

  /**
   * Runs the Z reduction: velocity texture alpha (per-point partial sums) →
   * halving chain → 1×1 Z, consumed by the repulsion shaders next tick.
   */
  private reduceZ (): void {
    const { device, store, points } = this
    if (!points?.velocityTexture || points.velocityTexture.destroyed) return
    if (!this.zReduceCommand || !this.zReduceUniformStore) return
    if (this.zReduceTargets.length === 0) return

    let input: Texture = points.velocityTexture
    let inputSize = store.pointsTextureSize ?? 0
    for (let i = 0; i < this.zReduceTargets.length; i++) {
      const target = this.zReduceTargets[i]
      if (!target || target.fbo.destroyed) return
      this.zReduceUniformStore.setUniforms({
        reduceSumUniforms: {
          inputWidth: inputSize,
          inputHeight: inputSize,
          readAlpha: i === 0 ? 1 : 0,
        },
      })
      this.zReduceCommand.setBindings({ reduceInput: input })
      const pass = device.beginRenderPass({ framebuffer: target.fbo, clearColor: [0, 0, 0, 0] })
      this.zReduceCommand.draw(pass)
      pass.end()
      input = target.texture
      inputSize = target.texture.width
    }

    // EMA-smooth the raw Z into the back ping-pong target, then flip: repulsion
    // reads zFinalTexture (the new front) next tick.
    const raw = this.zReduceTargets[this.zReduceTargets.length - 1]
    const front = this.zSmoothTargets[this.zSmoothIndex]
    const back = this.zSmoothTargets[this.zSmoothIndex ^ 1]
    if (this.zEmaCommand && this.zEmaUniformStore && raw && front && back && !back.fbo.destroyed) {
      this.zEmaUniformStore.setUniforms({ reduceEmaUniforms: { emaAlpha: Z_EMA_ALPHA } })
      this.zEmaCommand.setBindings({ rawInput: raw.texture, prevInput: front.texture })
      const pass = device.beginRenderPass({ framebuffer: back.fbo, clearColor: [0, 0, 0, 0] })
      this.zEmaCommand.draw(pass)
      pass.end()
      this.zSmoothIndex ^= 1
    }
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
        alpha: this.effectiveAlpha,
        repulsion: this.effectiveRepulsion,
        ...this.umapKernelUniforms,
      },
    })

    // Update texture bindings dynamically
    this.bruteForce3DCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      randomValues: this.randomValuesTexture,
      ...(this.config.simulationKernel === 'tsne' && this.zFinalTexture ? { zTexture: this.zFinalTexture } : {}),
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
          alpha: this.effectiveAlpha,
          repulsion: this.effectiveRepulsion,
          ...this.umapKernelUniforms,
        },
      })

      // Update texture bindings dynamically
      this.forceLevel3DCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        levelTexture: target.texture,
        ...(this.config.simulationKernel === 'tsne' && this.zFinalTexture ? { zTexture: this.zFinalTexture } : {}),
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
            alpha: this.effectiveAlpha,
            repulsion: this.effectiveRepulsion,
            ...this.umapKernelUniforms,
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
          ...(this.config.simulationKernel === 'tsne' && this.zFinalTexture ? { zTexture: this.zFinalTexture } : {}),
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
          alpha: this.effectiveAlpha,
          repulsion: this.effectiveRepulsion,
          spaceSize: store.adjustedSpaceSize,
          theta: this.config.simulationRepulsionTheta,
          ...this.umapKernelUniforms,
        },
      })

      // Update texture bindings dynamically
      this.forceCommand.setBindings({
        positionsTexture: points.previousPositionTexture,
        levelFbo: target.texture,
        ...(this.config.simulationKernel === 'tsne' && this.zFinalTexture ? { zTexture: this.zFinalTexture } : {}),
      })

      this.forceCommand.draw(drawPass)

      // Only the deepest level uses the centermass fallback
      if (level === this.levels - 1) {
        this.forceCenterUniformStore.setUniforms({
          forceCenterUniforms: {
            levelTextureSize,
            alpha: this.effectiveAlpha,
            repulsion: this.effectiveRepulsion,
            ...this.umapKernelUniforms,
          },
        })

        // Update texture bindings dynamically
        this.forceFromItsOwnCentermassCommand.setBindings({
          positionsTexture: points.previousPositionTexture,
          randomValues: this.randomValuesTexture,
          levelFbo: target.texture,
          ...(this.config.simulationKernel === 'tsne' && this.zFinalTexture ? { zTexture: this.zFinalTexture } : {}),
        })
        this.forceFromItsOwnCentermassCommand.draw(drawPass)
      }
    }

    drawPass.end()
  }
}
