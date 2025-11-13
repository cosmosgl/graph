import {Device, Framebuffer, Buffer, Texture, RenderPass} from '@luma.gl/core'
import {Model} from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import calculateCentermassFrag from '@/graph/modules/Clusters/calculate-centermass.frag'
import calculateCentermassVert from '@/graph/modules/Clusters/calculate-centermass.vert'
import forceFrag from '@/graph/modules/Clusters/force-cluster.frag'
import { createQuadBuffer, createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import clearFrag from '@/graph/modules/Shared/clear.frag'
import updateVert from '@/graph/modules/Shared/quad.vert'

export class Clusters extends CoreModule {
  public centermassFbo: Framebuffer | undefined
  public clusterCount: number | undefined

  private clusterFbo: Framebuffer | undefined
  private clusterPositionsFbo: Framebuffer | undefined
  private clusterForceCoefficientFbo: Framebuffer | undefined
  private clearCentermassCommand: Model | undefined
  private calculateCentermassCommand: Model | undefined
  private applyForcesCommand: Model | undefined
  private clusterTexture: Texture | undefined
  private clusterPositionsTexture: Texture | undefined
  private clusterForceCoefficientTexture: Texture | undefined
  private centermassTexture: Texture | undefined
  private pointIndices: Buffer | undefined
  private clustersTextureSize: number | undefined

  // Track previous sizes to detect changes
  private previousPointsTextureSize: number | undefined
  private previousClustersTextureSize: number | undefined
  private previousClusterCount: number | undefined

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
      // Destroy framebuffer FIRST (before texture)
      if (this.clusterFbo && !this.clusterFbo.destroyed) {
        this.clusterFbo.destroy()
      }
      // Then destroy texture
      if (this.clusterTexture && !this.clusterTexture.destroyed) {
        this.clusterTexture.destroy()
      }
      // Create new texture
      this.clusterTexture = device.createTexture({
        data: clusterState,
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      // Create new framebuffer with explicit dimensions
      this.clusterFbo = device.createFramebuffer({
        width: pointsTextureSize,
        height: pointsTextureSize,
        colorAttachments: [this.clusterTexture],
      })
    } else {
      // Size hasn't changed, just update the data
      this.clusterTexture.copyImageData({
        data: clusterState,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Handle clusterPositionsTexture
    if (!this.clusterPositionsTexture || sizesChanged) {
      // Destroy framebuffer FIRST
      if (this.clusterPositionsFbo && !this.clusterPositionsFbo.destroyed) {
        this.clusterPositionsFbo.destroy()
      }
      // Then destroy texture
      if (this.clusterPositionsTexture && !this.clusterPositionsTexture.destroyed) {
        this.clusterPositionsTexture.destroy()
      }
      // Create new texture
      this.clusterPositionsTexture = device.createTexture({
        data: clusterPositions,
        width: this.clustersTextureSize,
        height: this.clustersTextureSize,
        format: 'rgba32float',
      })
      // Create new framebuffer with explicit dimensions
      this.clusterPositionsFbo = device.createFramebuffer({
        width: this.clustersTextureSize,
        height: this.clustersTextureSize,
        colorAttachments: [this.clusterPositionsTexture],
      })
    } else {
      // Update data
      this.clusterPositionsTexture.copyImageData({
        data: clusterPositions,
        mipLevel: 0,
        x: 0,
        y: 0,
      })
    }

    // Handle clusterForceCoefficientTexture
    if (!this.clusterForceCoefficientTexture || sizesChanged) {
      // Destroy framebuffer FIRST
      if (this.clusterForceCoefficientFbo && !this.clusterForceCoefficientFbo.destroyed) {
        this.clusterForceCoefficientFbo.destroy()
      }
      // Then destroy texture
      if (this.clusterForceCoefficientTexture && !this.clusterForceCoefficientTexture.destroyed) {
        this.clusterForceCoefficientTexture.destroy()
      }
      // Create new texture
      this.clusterForceCoefficientTexture = device.createTexture({
        data: clusterForceCoefficient,
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
      })
      // Create new framebuffer with explicit dimensions
      this.clusterForceCoefficientFbo = device.createFramebuffer({
        width: pointsTextureSize,
        height: pointsTextureSize,
        colorAttachments: [this.clusterForceCoefficientTexture],
      })
    } else {
      // Update data
      this.clusterForceCoefficientTexture.copyImageData({
        data: clusterForceCoefficient,
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
        data: new Float32Array(clustersTextureDataSize).fill(0),
        width: this.clustersTextureSize,
        height: this.clustersTextureSize,
        format: 'rgba32float',
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
    if (data.pointClusters === undefined) return

    if (!this.clearCentermassCommand) {
      this.clearCentermassCommand = new Model(device, {
        fs: clearFrag,
        vs: updateVert,
        topology: 'triangle-strip',
        vertexCount: 4,
        attributes: {
          vertexCoord: device.createBuffer({
            data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
          })
        },
        bufferLayout: [
          {name: 'vertexCoord', format: 'float32x2'}  // 2 floats per vertex
        ]
      })
    }
    if (!this.calculateCentermassCommand) {
      this.calculateCentermassCommand = new Model(device, {
        frag: calculateCentermassFrag,
        vert: calculateCentermassVert,
        framebuffer: () => this.centermassFbo as Framebuffer,
        primitive: 'points',
        count: () => data.pointsNumber ?? 0,
        attributes: {
          pointIndices: {
            buffer: this.pointIndices,
            size: 2,
          },
        },
        uniforms: {
          positionsTexture: () => points?.previousPositionFbo,
          pointsTextureSize: () => store.pointsTextureSize,
          clusterTexture: () => this.clusterFbo,
          clustersTextureSize: () => this.clustersTextureSize,
        },
        blend: {
          enable: true,
          func: {
            src: 'one',
            dst: 'one',
          },
          equation: {
            rgb: 'add',
            alpha: 'add',
          },
        },
        depth: { enable: false, mask: false },
        stencil: { enable: false },
      })
    }
    if (!this.applyForcesCommand) {
      this.applyForcesCommand = new Model(device, ({
        frag: forceFrag,
        vert: updateVert,
        framebuffer: () => points?.velocityFbo as Framebuffer,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(device) },
        uniforms: {
          positionsTexture: () => points?.previousPositionFbo,
          clusterTexture: () => this.clusterFbo,
          centermassTexture: () => this.centermassFbo,
          clusterPositionsTexture: () => this.clusterPositionsFbo,
          clusterForceCoefficient: () => this.clusterForceCoefficientFbo,
          alpha: () => store.alpha,
          clustersTextureSize: () => this.clustersTextureSize,
          clusterCoefficient: () => this.config.simulationCluster,
        },
      })
    }
  }

  public calculateCentermass (renderPass: RenderPass): void {
    this.clearCentermassCommand?.draw(renderPass)
    this.calculateCentermassCommand?.draw(renderPass)
  }

  public run (renderPass: RenderPass): void {
    if (!this.data.pointClusters && !this.data.clusterPositions) return
    this.calculateCentermass(renderPass)
    this.applyForcesCommand?.draw(renderPass)
  }
}
