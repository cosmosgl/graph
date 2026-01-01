import { Framebuffer, Buffer, Texture, UniformStore, RenderPass } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import calculateCentermassFrag from '@/graph/modules/Clusters/calculate-centermass.frag?raw'
import calculateCentermassVert from '@/graph/modules/Clusters/calculate-centermass.vert?raw'
import forceFrag from '@/graph/modules/Clusters/force-cluster.frag?raw'
import { createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import clearFrag from '@/graph/modules/Shared/clear.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export class Clusters extends CoreModule {
  public centermassFbo: Framebuffer | undefined
  public clusterCount: number | undefined

  private clearCentermassCommand: Model | undefined
  private calculateCentermassCommand: Model | undefined
  private applyForcesCommand: Model | undefined
  private clusterTexture: Texture | undefined
  private clusterPositionsTexture: Texture | undefined
  private clusterForceCoefficientTexture: Texture | undefined
  private centermassTexture: Texture | undefined
  private pointIndices: Buffer | undefined
  private clustersTextureSize: number | undefined

  // Attribute buffers that need manual cleanup (Model doesn't destroy them)
  private clearCentermassVertexCoordBuffer: Buffer | undefined
  private applyForcesVertexCoordBuffer: Buffer | undefined

  // Track previous sizes to detect changes
  private previousPointsTextureSize: number | undefined
  private previousClustersTextureSize: number | undefined
  private previousClusterCount: number | undefined

  // Uniform stores for scalar uniforms
  private calculateCentermassUniformStore: UniformStore<{
    calculateCentermassUniforms: {
      pointsTextureSize: number;
      clustersTextureSize: number;
    };
  }> | undefined

  private applyForcesUniformStore: UniformStore<{
    applyForcesUniforms: {
      alpha: number;
      clustersTextureSize: number;
      clusterCoefficient: number;
    };
  }> | undefined

  public create (): void {
    const { device, store, data } = this
    const { pointsTextureSize } = store
    if (data.pointsNumber === undefined || (!data.pointClusters && !data.clusterPositions)) return

    // Find the highest cluster index in the array and add 1 (since cluster indices start at 0).
    this.clusterCount = (data.pointClusters ?? []).reduce<number>((max, clusterIndex) => {
      if (clusterIndex === undefined || clusterIndex < 0) return max
      return Math.max(max, clusterIndex)
    }, 0) + 1

    this.clustersTextureSize = Math.ceil(Math.sqrt(this.clusterCount))

    // Check if sizes have changed - if so, we need to recreate textures/framebuffers
    const sizesChanged =
      this.previousPointsTextureSize !== pointsTextureSize ||
      this.previousClustersTextureSize !== this.clustersTextureSize ||
      this.previousClusterCount !== this.clusterCount

    const pointsTextureDataSize = pointsTextureSize * pointsTextureSize * 4
    const clustersTextureDataSize = this.clustersTextureSize * this.clustersTextureSize * 4

    const clusterState = new Float32Array(pointsTextureDataSize)
    const clusterPositions = new Float32Array(clustersTextureDataSize).fill(-1)
    const clusterForceCoefficient = new Float32Array(pointsTextureDataSize).fill(1)
    if (data.clusterPositions) {
      for (let cluster = 0; cluster < this.clusterCount; ++cluster) {
        clusterPositions[cluster * 4 + 0] = data.clusterPositions[cluster * 2 + 0] ?? -1
        clusterPositions[cluster * 4 + 1] = data.clusterPositions[cluster * 2 + 1] ?? -1
      }
    }

    for (let i = 0; i < data.pointsNumber; ++i) {
      const clusterIndex = data.pointClusters?.[i]
      if (clusterIndex === undefined) {
        // no cluster, so no forces
        clusterState[i * 4 + 0] = -1
        clusterState[i * 4 + 1] = -1
      } else {
        clusterState[i * 4 + 0] = clusterIndex % this.clustersTextureSize
        clusterState[i * 4 + 1] = Math.floor(clusterIndex / this.clustersTextureSize)
      }

      if (data.clusterStrength) clusterForceCoefficient[i * 4 + 0] = data.clusterStrength[i] ?? 1
    }

    // Handle clusterTexture - recreate if size changed, update data if size same
    if (!this.clusterTexture || sizesChanged) {
      // Then destroy texture
      if (this.clusterTexture && !this.clusterTexture.destroyed) {
        this.clusterTexture.destroy()
      }
      // Create new texture
      this.clusterTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      })
      this.clusterTexture.copyImageData({
        data: clusterState,
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    } else {
      // Size hasn't changed, just update the data
      this.clusterTexture.copyImageData({
        data: clusterState,
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Handle clusterPositionsTexture
    if (!this.clusterPositionsTexture || sizesChanged) {
      // Then destroy texture
      if (this.clusterPositionsTexture && !this.clusterPositionsTexture.destroyed) {
        this.clusterPositionsTexture.destroy()
      }
      // Create new texture
      this.clusterPositionsTexture = device.createTexture({
        width: this.clustersTextureSize,
        height: this.clustersTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      })
      this.clusterPositionsTexture.copyImageData({
        data: clusterPositions,
        bytesPerRow: this.clustersTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    } else {
      // Update data
      this.clusterPositionsTexture.copyImageData({
        data: clusterPositions,
        bytesPerRow: this.clustersTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Handle clusterForceCoefficientTexture
    if (!this.clusterForceCoefficientTexture || sizesChanged) {
      // Then destroy texture
      if (this.clusterForceCoefficientTexture && !this.clusterForceCoefficientTexture.destroyed) {
        this.clusterForceCoefficientTexture.destroy()
      }
      // Create new texture
      this.clusterForceCoefficientTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      })
      this.clusterForceCoefficientTexture.copyImageData({
        data: clusterForceCoefficient,
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    } else {
      // Update data
      this.clusterForceCoefficientTexture.copyImageData({
        data: clusterForceCoefficient,
        bytesPerRow: pointsTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Handle centermassTexture - only size depends on clustersTextureSize
    if (!this.centermassTexture || this.previousClustersTextureSize !== this.clustersTextureSize) {
      // Destroy framebuffer FIRST
      if (this.centermassFbo && !this.centermassFbo.destroyed) {
        this.centermassFbo.destroy()
      }
      // Then destroy texture
      if (this.centermassTexture && !this.centermassTexture.destroyed) {
        this.centermassTexture.destroy()
      }
      // Create new texture
      this.centermassTexture = device.createTexture({
        width: this.clustersTextureSize,
        height: this.clustersTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST,
      })
      this.centermassTexture.copyImageData({
        data: new Float32Array(clustersTextureDataSize).fill(0),
        bytesPerRow: this.clustersTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
      // Create new framebuffer with explicit dimensions
      this.centermassFbo = device.createFramebuffer({
        width: this.clustersTextureSize,
        height: this.clustersTextureSize,
        colorAttachments: [this.centermassTexture],
      })
    } else {
      // Clear the centermass texture (fill with zeros)
      this.centermassTexture.copyImageData({
        data: new Float32Array(clustersTextureDataSize).fill(0),
        bytesPerRow: this.clustersTextureSize,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Update pointIndices buffer if pointsTextureSize changed
    if (!this.pointIndices || this.previousPointsTextureSize !== pointsTextureSize) {
      if (this.pointIndices && !this.pointIndices.destroyed) {
        this.pointIndices.destroy()
      }
      const indexData = createIndexesForBuffer(store.pointsTextureSize)
      this.pointIndices = device.createBuffer({
        data: indexData,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      })
    }

    // Update tracked sizes
    this.previousPointsTextureSize = pointsTextureSize
    this.previousClustersTextureSize = this.clustersTextureSize
    this.previousClusterCount = this.clusterCount
  }

  public initPrograms (): void {
    const { device, store, data, points } = this
    // Use same check as create() and run() for consistency
    if (!data.pointClusters && !data.clusterPositions) return

    if (!this.clearCentermassCommand) {
      // Create and track vertexCoord buffer
      if (!this.clearCentermassVertexCoordBuffer) {
        this.clearCentermassVertexCoordBuffer = device.createBuffer({
          data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        })
      }

      this.clearCentermassCommand = new Model(device, {
        fs: clearFrag,
        vs: updateVert,
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: {
          vertexCoord: this.clearCentermassVertexCoordBuffer,
        },
        bufferLayout: [
          { name: 'vertexCoord', format: 'float32x2' }, // 2 floats per vertex
        ],
      })
    }
    if (!this.calculateCentermassCommand) {
      // Ensure pointIndices buffer exists
      if (!this.pointIndices) {
        const indexData = createIndexesForBuffer(store.pointsTextureSize)
        this.pointIndices = device.createBuffer({
          data: indexData,
          usage: Buffer.VERTEX | Buffer.COPY_DST,
        })
      }

      // Create UniformStore for calculateCentermass uniforms
      if (!this.calculateCentermassUniformStore) {
        this.calculateCentermassUniformStore = new UniformStore({
          calculateCentermassUniforms: {
            uniformTypes: {
              pointsTextureSize: 'f32',
              clustersTextureSize: 'f32',
            },
            defaultUniforms: {
              pointsTextureSize: store.pointsTextureSize,
              clustersTextureSize: (this.clustersTextureSize ?? 0),
            },
          },
        })
      }

      this.calculateCentermassCommand = new Model(device, {
        fs: calculateCentermassFrag,
        vs: calculateCentermassVert,
        topology: 'point-list',
        vertexCount: data.pointsNumber ?? 0,
        attributes: {
          pointIndices: this.pointIndices,
        },
        bufferLayout: [
          { name: 'pointIndices', format: 'float32x2' }, // 2 floats per vertex
        ],
        defines: {
          USE_UNIFORM_BUFFERS: true, // Enable uniform buffers
        },
        bindings: {
          // Uniform buffer via UniformStore (WebGPU-compatible)
          calculateCentermassUniforms: this.calculateCentermassUniformStore.getManagedUniformBuffer(device, 'calculateCentermassUniforms'),
          ...(this.clusterTexture && { clusterTexture: this.clusterTexture }),
          ...(points?.previousPositionTexture && { positionsTexture: points.previousPositionTexture }),
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
    if (!this.applyForcesCommand) {
      // Create UniformStore for applyForces uniforms
      if (!this.applyForcesUniformStore) {
        this.applyForcesUniformStore = new UniformStore({
          applyForcesUniforms: {
            uniformTypes: {
              alpha: 'f32',
              clustersTextureSize: 'f32',
              clusterCoefficient: 'f32',
            },
            defaultUniforms: {
              alpha: store.alpha,
              clustersTextureSize: (this.clustersTextureSize ?? 0),
              clusterCoefficient: (this.config.simulationCluster ?? 0),
            },
          },
        })
      }

      // Create and track vertexCoord buffer
      if (!this.applyForcesVertexCoordBuffer) {
        this.applyForcesVertexCoordBuffer = device.createBuffer({
          data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        })
      }

      this.applyForcesCommand = new Model(device, {
        fs: forceFrag,
        vs: updateVert,
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: {
          vertexCoord: this.applyForcesVertexCoordBuffer,
        },
        bufferLayout: [
          { name: 'vertexCoord', format: 'float32x2' }, // 2 floats per vertex
        ],
        defines: {
          USE_UNIFORM_BUFFERS: true, // Enable uniform buffers
        },
        bindings: {
          // Uniform buffer via UniformStore (WebGPU-compatible)
          applyForcesUniforms: this.applyForcesUniformStore.getManagedUniformBuffer(device, 'applyForcesUniforms'),
          ...(this.clusterTexture && { clusterTexture: this.clusterTexture }),
          ...(this.centermassTexture && { centermassTexture: this.centermassTexture }),
          ...(this.clusterPositionsTexture && { clusterPositionsTexture: this.clusterPositionsTexture }),
          ...(this.clusterForceCoefficientTexture && { clusterForceCoefficient: this.clusterForceCoefficientTexture }),
          ...(points?.previousPositionTexture && { positionsTexture: points.previousPositionTexture }),
        },
      })
    }
  }

  public calculateCentermass (): void {
    // Add safety check
    if (!this.calculateCentermassCommand || !this.calculateCentermassUniformStore) {
      return
    }

    if (!this.centermassFbo || this.centermassFbo.destroyed) return
    if (!this.clusterTexture || this.clusterTexture.destroyed) return
    if (!this.points?.previousPositionTexture || this.points.previousPositionTexture.destroyed) return

    // Update vertex count dynamically (using same fallback logic as initialization)
    this.calculateCentermassCommand.setVertexCount(this.data.pointsNumber ?? 0)

    // Update UniformStore with current values
    this.calculateCentermassUniformStore.setUniforms({
      calculateCentermassUniforms: {
        pointsTextureSize: this.store.pointsTextureSize,
        clustersTextureSize: (this.clustersTextureSize ?? 0),
      },
    })

    // Update bindings dynamically
    this.calculateCentermassCommand.setBindings({
      calculateCentermassUniforms: this.calculateCentermassUniformStore.getManagedUniformBuffer(this.device, 'calculateCentermassUniforms'),
      clusterTexture: this.clusterTexture,
      positionsTexture: this.points.previousPositionTexture,
    })

    // Create a RenderPass for the centermass framebuffer
    const centermassPass = this.device.beginRenderPass({
      framebuffer: this.centermassFbo,
    })

    this.clearCentermassCommand?.draw(centermassPass)
    this.calculateCentermassCommand.draw(centermassPass)

    centermassPass.end()
  }

  public run (renderPass?: RenderPass): void {
    if (!this.data.pointClusters && !this.data.clusterPositions) return

    // Calculate centermass (creates its own RenderPass - different framebuffer)
    this.calculateCentermass()

    // Add safety check
    if (!this.applyForcesCommand || !this.applyForcesUniformStore) {
      return
    }

    // Add destroyed checks for resources before use
    if (!this.clusterTexture || this.clusterTexture.destroyed) return
    if (!this.centermassTexture || this.centermassTexture.destroyed) return
    if (!this.clusterPositionsTexture || this.clusterPositionsTexture.destroyed) return
    if (!this.clusterForceCoefficientTexture || this.clusterForceCoefficientTexture.destroyed) return
    if (!this.points?.previousPositionTexture || this.points.previousPositionTexture.destroyed) return
    if (!this.points?.velocityFbo || this.points.velocityFbo.destroyed) return

    // Update UniformStore with current values
    this.applyForcesUniformStore.setUniforms({
      applyForcesUniforms: {
        alpha: this.store.alpha,
        clustersTextureSize: (this.clustersTextureSize ?? 0),
        clusterCoefficient: this.config.simulationCluster ?? 0,
      },
    })

    // Update bindings dynamically
    this.applyForcesCommand.setBindings({
      applyForcesUniforms: this.applyForcesUniformStore.getManagedUniformBuffer(this.device, 'applyForcesUniforms'),
      clusterTexture: this.clusterTexture,
      centermassTexture: this.centermassTexture,
      clusterPositionsTexture: this.clusterPositionsTexture,
      clusterForceCoefficient: this.clusterForceCoefficientTexture,
      positionsTexture: this.points.previousPositionTexture,
    })

    // Use provided render pass or create one if not provided (backward compatibility)
    if (renderPass) {
      // Use the provided render pass (created in simulation loop)
      this.applyForcesCommand.draw(renderPass)
    } else {
      // Create a RenderPass for the velocity framebuffer (fallback for backward compatibility)
      const velocityPass = this.device.beginRenderPass({
        framebuffer: this.points.velocityFbo,
      })

      this.applyForcesCommand.draw(velocityPass)

      velocityPass.end()
    }
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
    this.applyForcesCommand?.destroy()
    this.applyForcesCommand = undefined

    // 2. Destroy Framebuffers (before textures they reference)
    if (this.centermassFbo && !this.centermassFbo.destroyed) {
      this.centermassFbo.destroy()
    }
    this.centermassFbo = undefined

    // 3. Destroy Textures
    if (this.clusterTexture && !this.clusterTexture.destroyed) {
      this.clusterTexture.destroy()
    }
    this.clusterTexture = undefined
    if (this.clusterPositionsTexture && !this.clusterPositionsTexture.destroyed) {
      this.clusterPositionsTexture.destroy()
    }
    this.clusterPositionsTexture = undefined
    if (this.clusterForceCoefficientTexture && !this.clusterForceCoefficientTexture.destroyed) {
      this.clusterForceCoefficientTexture.destroy()
    }
    this.clusterForceCoefficientTexture = undefined
    if (this.centermassTexture && !this.centermassTexture.destroyed) {
      this.centermassTexture.destroy()
    }
    this.centermassTexture = undefined

    // 4. Destroy UniformStores (Models already destroyed their managed uniform buffers)
    this.calculateCentermassUniformStore?.destroy()
    this.calculateCentermassUniformStore = undefined
    this.applyForcesUniformStore?.destroy()
    this.applyForcesUniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models, must destroy manually)
    if (this.pointIndices && !this.pointIndices.destroyed) {
      this.pointIndices.destroy()
    }
    this.pointIndices = undefined
    if (this.clearCentermassVertexCoordBuffer && !this.clearCentermassVertexCoordBuffer.destroyed) {
      this.clearCentermassVertexCoordBuffer.destroy()
    }
    this.clearCentermassVertexCoordBuffer = undefined
    if (this.applyForcesVertexCoordBuffer && !this.applyForcesVertexCoordBuffer.destroyed) {
      this.applyForcesVertexCoordBuffer.destroy()
    }
    this.applyForcesVertexCoordBuffer = undefined
  }
}
