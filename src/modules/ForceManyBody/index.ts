import { Buffer, Framebuffer, RenderPass, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import calculateLevelFrag from '@/graph/modules/ForceManyBody/calculate-level.frag?raw'
import calculateLevelVert from '@/graph/modules/ForceManyBody/calculate-level.vert?raw'
import forceFrag from '@/graph/modules/ForceManyBody/force-level.frag?raw'
import forceCenterFrag from '@/graph/modules/ForceManyBody/force-centermass.frag?raw'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import clearFrag from '@/graph/modules/Shared/clear.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

type LevelTarget = {
  texture: Texture;
  fbo: Framebuffer;
}

export class ForceManyBody extends CoreModule {
  private randomValuesTexture: Texture | undefined
  private pointIndices: Buffer | undefined
  private levels = 0
  private levelTargets = new Map<number, LevelTarget>()

  private clearLevelsCommand: Model | undefined
  private calculateLevelsCommand: Model | undefined
  private forceCommand: Model | undefined
  private forceFromItsOwnCentermassCommand: Model | undefined

  private clearLevelsVertexCoordBuffer: Buffer | undefined
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

  private previousPointsTextureSize: number | undefined
  private previousSpaceSize: number | undefined

  public create (): void {
    const { device, store } = this
    if (!store.pointsTextureSize) return

    this.levels = Math.log2(store.adjustedSpaceSize)

    // Allocate quadtree levels
    for (let level = 0; level < this.levels; level += 1) {
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
        if (!existingTarget.texture.destroyed) existingTarget.texture.destroy()
        if (!existingTarget.fbo.destroyed) existingTarget.fbo.destroy()
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
        if (!target.texture.destroyed) target.texture.destroy()
        if (!target.fbo.destroyed) target.fbo.destroy()
        this.levelTargets.delete(level)
      }
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

    // Point index buffer
    const indexData = createIndexesForBuffer(store.pointsTextureSize)
    const requiredByteLength = indexData.byteLength
    if (!this.pointIndices || this.pointIndices.byteLength !== requiredByteLength) {
      this.pointIndices?.destroy()
      this.pointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.pointIndices.write(indexData)
    }

    this.previousPointsTextureSize = store.pointsTextureSize
    this.previousSpaceSize = store.adjustedSpaceSize
  }

  public initPrograms (): void {
    const { device, store, data, points } = this
    if (!data.pointsNumber || !points || !store.pointsTextureSize) return

    // Clear levels command (fullscreen quad)
    this.clearLevelsVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })
    this.clearLevelsCommand ||= new Model(device, {
      fs: clearFrag,
      vs: updateVert,
      topology: 'triangle-strip',
      vertexCount: 4,
      attributes: {
        vertexCoord: this.clearLevelsVertexCoordBuffer,
      },
      bufferLayout: [
        { name: 'vertexCoord', format: 'float32x2' },
      ],
    })

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
        pointIndices: this.pointIndices!,
      },
      bufferLayout: [
        { name: 'pointIndices', format: 'float32x2' },
      ],
      defines: {
        USE_UNIFORM_BUFFERS: true,
      },
      bindings: {
        calculateLevelsUniforms: this.calculateLevelsUniformStore.getManagedUniformBuffer(device, 'calculateLevelsUniforms'),
        positionsTexture: points.previousPositionTexture!,
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
          repulsion: this.config.simulationRepulsion ?? 0,
          spaceSize: store.adjustedSpaceSize ?? 0,
          theta: this.config.simulationRepulsionTheta ?? 0,
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
        forceUniforms: this.forceUniformStore.getManagedUniformBuffer(device, 'forceUniforms'),
        positionsTexture: points.previousPositionTexture!,
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
          repulsion: this.config.simulationRepulsion ?? 0,
        },
      },
    })

    this.forceVertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
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
        forceCenterUniforms: this.forceCenterUniformStore.getManagedUniformBuffer(device, 'forceCenterUniforms'),
        positionsTexture: points.previousPositionTexture!,
        randomValues: this.randomValuesTexture!,
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

  public run (renderPass?: RenderPass): void {
    // Skip if sizes changed and create() wasn't called yet
    if (this.store.pointsTextureSize !== this.previousPointsTextureSize || this.store.adjustedSpaceSize !== this.previousSpaceSize) {
      return
    }
    this.drawLevels()
    this.drawForces(renderPass)
  }

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   */
  public destroy (): void {
    // 1. Destroy Models FIRST (they destroy _gpuGeometry if exists, and _uniformStore)
    this.clearLevelsCommand?.destroy()
    this.clearLevelsCommand = undefined
    this.calculateLevelsCommand?.destroy()
    this.calculateLevelsCommand = undefined
    this.forceCommand?.destroy()
    this.forceCommand = undefined
    this.forceFromItsOwnCentermassCommand?.destroy()
    this.forceFromItsOwnCentermassCommand = undefined

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

    // 4. Destroy UniformStores (Models already destroyed their managed uniform buffers)
    this.calculateLevelsUniformStore?.destroy()
    this.calculateLevelsUniformStore = undefined
    this.forceUniformStore?.destroy()
    this.forceUniformStore = undefined
    this.forceCenterUniformStore?.destroy()
    this.forceCenterUniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models, must destroy manually)
    if (this.pointIndices && !this.pointIndices.destroyed) {
      this.pointIndices.destroy()
    }
    this.pointIndices = undefined
    if (this.clearLevelsVertexCoordBuffer && !this.clearLevelsVertexCoordBuffer.destroyed) {
      this.clearLevelsVertexCoordBuffer.destroy()
    }
    this.clearLevelsVertexCoordBuffer = undefined
    if (this.forceVertexCoordBuffer && !this.forceVertexCoordBuffer.destroyed) {
      this.forceVertexCoordBuffer.destroy()
    }
    this.forceVertexCoordBuffer = undefined
  }

  private drawLevels (): void {
    const { device, store, data, points } = this
    if (!points || !data.pointsNumber || !this.calculateLevelsCommand || !this.calculateLevelsUniformStore || !this.clearLevelsCommand) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return

    for (let level = 0; level < this.levels; level += 1) {
      const target = this.levelTargets.get(level)
      if (!target || target.fbo.destroyed || target.texture.destroyed) continue

      const levelTextureSize = Math.pow(2, level + 1)
      const cellSize = (store.adjustedSpaceSize ?? 0) / levelTextureSize

      this.calculateLevelsUniformStore.setUniforms({
        calculateLevelsUniforms: {
          pointsTextureSize: store.pointsTextureSize ?? 0,
          levelTextureSize,
          cellSize,
        },
      })

      this.calculateLevelsCommand.setVertexCount(data.pointsNumber)
      this.calculateLevelsCommand.setBindings({
        calculateLevelsUniforms: this.calculateLevelsUniformStore.getManagedUniformBuffer(device, 'calculateLevelsUniforms'),
        positionsTexture: points.previousPositionTexture!,
      })

      const levelPass = device.beginRenderPass({
        framebuffer: target.fbo,
        clearColor: [0, 0, 0, 0],
      })

      this.clearLevelsCommand.draw(levelPass)
      this.calculateLevelsCommand.draw(levelPass)

      levelPass.end()
    }
  }

  private drawForces (renderPass?: RenderPass): void {
    const { device, store, points } = this
    if (!points || !this.forceCommand || !this.forceUniformStore || !this.forceFromItsOwnCentermassCommand || !this.forceCenterUniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!this.randomValuesTexture || this.randomValuesTexture.destroyed) return
    if (!renderPass && (!points.velocityFbo || points.velocityFbo.destroyed)) return

    // Update bindings shared for both force commands
    this.forceCommand.setBindings({
      forceUniforms: this.forceUniformStore.getManagedUniformBuffer(device, 'forceUniforms'),
      positionsTexture: points.previousPositionTexture!,
    })
    this.forceFromItsOwnCentermassCommand.setBindings({
      forceCenterUniforms: this.forceCenterUniformStore.getManagedUniformBuffer(device, 'forceCenterUniforms'),
      positionsTexture: points.previousPositionTexture!,
      randomValues: this.randomValuesTexture!,
    })

    const drawPass = renderPass ?? device.beginRenderPass({
      framebuffer: points.velocityFbo,
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
          repulsion: this.config.simulationRepulsion ?? 0,
          spaceSize: store.adjustedSpaceSize ?? 0,
          theta: this.config.simulationRepulsionTheta ?? 0,
        },
      })

      this.forceCommand.setBindings({
        forceUniforms: this.forceUniformStore.getManagedUniformBuffer(device, 'forceUniforms'),
        positionsTexture: points.previousPositionTexture!,
        levelFbo: target.texture,
      })

      this.forceCommand.draw(drawPass)

      // Only the deepest level uses the centermass fallback
      if (level === this.levels - 1) {
        this.forceCenterUniformStore.setUniforms({
          forceCenterUniforms: {
            levelTextureSize,
            alpha: store.alpha,
            repulsion: this.config.simulationRepulsion ?? 0,
          },
        })
        this.forceFromItsOwnCentermassCommand.setBindings({
          forceCenterUniforms: this.forceCenterUniformStore.getManagedUniformBuffer(device, 'forceCenterUniforms'),
          positionsTexture: points.previousPositionTexture!,
          randomValues: this.randomValuesTexture!,
          levelFbo: target.texture,
        })
        this.forceFromItsOwnCentermassCommand.draw(drawPass)
      }
    }

    if (!renderPass) {
      drawPass.end()
    }
  }
}
