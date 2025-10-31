import {Device, Framebuffer, Buffer, Texture} from '@luma.gl/core'
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

    const clusterState = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
    const clusterPositions = new Float32Array(this.clustersTextureSize * this.clustersTextureSize * 4).fill(-1)
    const clusterForceCoefficient = new Float32Array(pointsTextureSize * pointsTextureSize * 4).fill(1)
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

    if (!this.clusterTexture) this.clusterTexture = device.createTexture({
      data: clusterState,
      width: pointsTextureSize,
      height: pointsTextureSize,
      format: 'rgba32float',
    })
    if (!this.clusterFbo) this.clusterFbo = device.createFramebuffer({
      colorAttachments: [this.clusterTexture],
    })

    if (!this.clusterPositionsTexture) this.clusterPositionsTexture = device.createTexture({
      data: clusterPositions,
      width: this.clustersTextureSize,
      height: this.clustersTextureSize,
      format: 'rgba32float',
    })

    if (!this.clusterPositionsFbo) this.clusterPositionsFbo = device.createFramebuffer({
      colorAttachments: [this.clusterPositionsTexture],
    })

    if (!this.clusterForceCoefficientTexture) this.clusterForceCoefficientTexture = device.createTexture({
      data: clusterForceCoefficient,
      width: pointsTextureSize,
      height: pointsTextureSize,
      format: 'rgba32float',
    })

    if (!this.clusterForceCoefficientFbo) this.clusterForceCoefficientFbo = device.createFramebuffer({
      colorAttachments: [this.clusterForceCoefficientTexture],
    })

    if (!this.centermassTexture) this.centermassTexture = device.createTexture({
      data: new Float32Array(this.clustersTextureSize * this.clustersTextureSize * 4).fill(0),
      width: this.clustersTextureSize,
      height: this.clustersTextureSize,
      format: 'rgba32float',
    })
    if (!this.centermassFbo) this.centermassFbo = device.createFramebuffer({
      colorAttachments: [this.centermassTexture],
    })

    // if (!this.pointIndices) this.pointIndices = device.createBuffer(0)
    //   this.pointIndices(createIndexesForBuffer(store.pointsTextureSize))
    
    if (!this.pointIndices) this.pointIndices = device.createBuffer({
      data: createIndexesForBuffer(store.pointsTextureSize),
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: createIndexesForBuffer(store.pointsTextureSize).byteLength,
    })
  }

  public initPrograms (): void {
    const { device, store, data, points } = this
    if (data.pointClusters === undefined) return

    if (!this.clearCentermassCommand) {
      this.clearCentermassCommand = new Model(device, {
        frag: clearFrag,
        vert: updateVert,
        framebuffer: () => this.centermassFbo as Framebuffer,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
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

  public calculateCentermass (): void {
    this.clearCentermassCommand?.draw()
    this.calculateCentermassCommand?.draw()
  }

  public run (): void {
    if (!this.data.pointClusters && !this.data.clusterPositions) return
    this.calculateCentermass()
    this.applyForcesCommand?.()
  }
}
