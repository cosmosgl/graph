import { Buffer, Framebuffer, RenderPass, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import calculateCentermassFrag from '@/graph/modules/ForceCenter/calculate-centermass.frag?raw'
import calculateCentermassVert from '@/graph/modules/ForceCenter/calculate-centermass.vert?raw'
import forceFrag from '@/graph/modules/ForceCenter/force-center.frag?raw'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import clearFrag from '@/graph/modules/Shared/clear.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export class ForceCenter extends CoreModule {
  private centermassTexture: Texture | undefined
  private centermassFbo: Framebuffer | undefined
  private pointIndices: Buffer | undefined

  private clearCentermassCommand: Model | undefined
  private calculateCentermassCommand: Model | undefined
  private runCommand: Model | undefined

  private clearVertexCoordBuffer: Buffer | undefined
  private forceVertexCoordBuffer: Buffer | undefined

  private calculateUniformStore: UniformStore<{
    calculateCentermassUniforms: {
      pointsTextureSize: number;
    };
  }> | undefined

  private forceUniformStore: UniformStore<{
    forceCenterUniforms: {
      centerForce: number;
      alpha: number;
    };
  }> | undefined

  private previousPointsTextureSize: number | undefined

  public create (): void {
    const { device, store } = this
    const { pointsTextureSize } = store
    if (!pointsTextureSize) return

    if (!this.centermassTexture || this.centermassTexture.destroyed) {
      this.centermassTexture = device.createTexture({
        width: 1,
        height: 1,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      })
    }
    this.centermassTexture.copyImageData({
      data: new Float32Array(4).fill(0),
      // WORKAROUND: luma.gl 9.2.3 bug - bytesPerRow incorrectly expects pixels here
      // (should be bytes). Correct value would be 1 * 16.
      bytesPerRow: 1,
      mipLevel: 0,
      x: 0,
      y: 0,
    })

    if (!this.centermassFbo || this.centermassFbo.destroyed) {
      this.centermassFbo = device.createFramebuffer({
        width: 1,
        height: 1,
        colorAttachments: [this.centermassTexture],
      })
    }

    const indexData = createIndexesForBuffer(pointsTextureSize)
    if (!this.pointIndices || this.pointIndices.byteLength !== indexData.byteLength) {
      this.pointIndices?.destroy()
      this.pointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    } else {
      this.pointIndices.write(indexData)
    }

    this.previousPointsTextureSize = pointsTextureSize
  }

  public initPrograms (): void {
    const { device, store, points } = this
    if (!points || !store.pointsTextureSize) return
    if (!this.centermassFbo || this.centermassFbo.destroyed || !this.centermassTexture || this.centermassTexture.destroyed) return
    if (!this.pointIndices) return

    // Fullscreen quad buffer (shared by clear and force passes)
    if (!this.clearVertexCoordBuffer || this.clearVertexCoordBuffer.destroyed) {
      this.clearVertexCoordBuffer = device.createBuffer({
        data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      })
    }
    if (!this.forceVertexCoordBuffer || this.forceVertexCoordBuffer.destroyed) {
      this.forceVertexCoordBuffer = device.createBuffer({
        data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      })
    }

    if (!this.calculateUniformStore) {
      this.calculateUniformStore = new UniformStore({
        calculateCentermassUniforms: {
          uniformTypes: {
            pointsTextureSize: 'f32',
          },
        },
      })
    }

    if (!this.forceUniformStore) {
      this.forceUniformStore = new UniformStore({
        forceCenterUniforms: {
          uniformTypes: {
            centerForce: 'f32',
            alpha: 'f32',
          },
        },
      })
    }

    if (!this.clearCentermassCommand) {
      this.clearCentermassCommand = new Model(device, {
        fs: clearFrag,
        vs: updateVert,
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: {
          vertexCoord: this.clearVertexCoordBuffer,
        },
        bufferLayout: [
          { name: 'vertexCoord', format: 'float32x2' },
        ],
        parameters: {
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      })
    }

    if (!this.calculateCentermassCommand) {
      this.calculateCentermassCommand = new Model(device, {
        fs: calculateCentermassFrag,
        vs: calculateCentermassVert,
        topology: 'point-list',
        vertexCount: this.data.pointsNumber ?? 0,
        attributes: {
          pointIndices: this.pointIndices,
        },
        bufferLayout: [
          { name: 'pointIndices', format: 'float32x2' },
        ],
        defines: {
          USE_UNIFORM_BUFFERS: true,
        },
        bindings: {
          calculateCentermassUniforms: this.calculateUniformStore.getManagedUniformBuffer(device, 'calculateCentermassUniforms'),
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
    } else {
      this.calculateCentermassCommand.setVertexCount(this.data.pointsNumber ?? 0)
    }

    if (!this.runCommand) {
      this.runCommand = new Model(device, {
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
          forceCenterUniforms: this.forceUniformStore.getManagedUniformBuffer(device, 'forceCenterUniforms'),
          positionsTexture: points.previousPositionTexture!,
          centermassTexture: this.centermassTexture,
        },
        parameters: {
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      })
    }
  }

  public run (renderPass?: RenderPass): void {
    const { device, store, points } = this
    if (!points || !this.centermassFbo || !this.centermassTexture) return
    if (!this.calculateCentermassCommand || !this.calculateUniformStore || !this.runCommand || !this.forceUniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!renderPass && (!points.velocityFbo || points.velocityFbo.destroyed)) return

    // Skip if sizes changed and create() wasn't called yet
    if (store.pointsTextureSize !== this.previousPointsTextureSize) return

    // Clear centermass then accumulate
    const centermassPass = device.beginRenderPass({
      framebuffer: this.centermassFbo,
      clearColor: [0, 0, 0, 0],
    })

    this.calculateUniformStore.setUniforms({
      calculateCentermassUniforms: {
        pointsTextureSize: store.pointsTextureSize ?? 0,
      },
    })
    this.calculateCentermassCommand.setBindings({
      calculateCentermassUniforms: this.calculateUniformStore.getManagedUniformBuffer(device, 'calculateCentermassUniforms'),
      positionsTexture: points.previousPositionTexture!,
    })

    // No need to draw clear model separately; pass clearColor already zeroed
    this.calculateCentermassCommand.draw(centermassPass)
    centermassPass.end()

    // Apply center force into velocity
    this.forceUniformStore.setUniforms({
      forceCenterUniforms: {
        centerForce: this.config.simulationCenter ?? 0,
        alpha: store.alpha,
      },
    })
    this.runCommand.setBindings({
      forceCenterUniforms: this.forceUniformStore.getManagedUniformBuffer(device, 'forceCenterUniforms'),
      positionsTexture: points.previousPositionTexture!,
      centermassTexture: this.centermassTexture,
    })

    const pass = renderPass ?? device.beginRenderPass({
      framebuffer: points.velocityFbo,
    })

    this.runCommand.draw(pass)

    if (!renderPass) pass.end()
  }

  /**
   * Destruction order matters
   * Models -> Framebuffers -> Textures -> UniformStores -> Buffers
   */
  public destroy (): void {
    // 1. Destroy Models FIRST (they destroy _gpuGeometry if exists, and _uniformStore)
    this.clearCentermassCommand?.destroy()
    this.clearCentermassCommand = undefined
    this.calculateCentermassCommand?.destroy()
    this.calculateCentermassCommand = undefined
    this.runCommand?.destroy()
    this.runCommand = undefined

    // 2. Destroy Framebuffers (before textures they reference)
    if (this.centermassFbo && !this.centermassFbo.destroyed) {
      this.centermassFbo.destroy()
    }
    this.centermassFbo = undefined

    // 3. Destroy Textures
    if (this.centermassTexture && !this.centermassTexture.destroyed) {
      this.centermassTexture.destroy()
    }
    this.centermassTexture = undefined

    // 4. Destroy UniformStores (Models already destroyed their managed uniform buffers)
    this.calculateUniformStore?.destroy()
    this.calculateUniformStore = undefined
    this.forceUniformStore?.destroy()
    this.forceUniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models, must destroy manually)
    if (this.pointIndices && !this.pointIndices.destroyed) {
      this.pointIndices.destroy()
    }
    this.pointIndices = undefined
    if (this.clearVertexCoordBuffer && !this.clearVertexCoordBuffer.destroyed) {
      this.clearVertexCoordBuffer.destroy()
    }
    this.clearVertexCoordBuffer = undefined
    if (this.forceVertexCoordBuffer && !this.forceVertexCoordBuffer.destroyed) {
      this.forceVertexCoordBuffer.destroy()
    }
    this.forceVertexCoordBuffer = undefined

    this.previousPointsTextureSize = undefined
  }
}
