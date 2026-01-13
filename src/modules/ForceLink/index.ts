import { Buffer, RenderPass, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import { forceFrag } from '@/graph/modules/ForceLink/force-spring'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export enum LinkDirection {
  OUTGOING = 'outgoing',
  INCOMING = 'incoming'
}

export class ForceLink extends CoreModule {
  private linkFirstIndicesAndAmount: Float32Array = new Float32Array()
  private indices: Float32Array = new Float32Array()
  private maxPointDegree = 0
  private previousMaxPointDegree: number | undefined
  private previousPointsTextureSize: number | undefined
  private previousLinksTextureSize: number | undefined

  private runCommand: Model | undefined
  private vertexCoordBuffer: Buffer | undefined
  private uniformStore: UniformStore<{
    forceLinkUniforms: {
      linkSpring: number;
      linkDistance: number;
      linkDistRandomVariationRange: [number, number];
      pointsTextureSize: number;
      linksTextureSize: number;
      alpha: number;
    };
  }> | undefined

  private linkFirstIndicesAndAmountTexture: Texture | undefined
  private indicesTexture: Texture | undefined
  private biasAndStrengthTexture: Texture | undefined
  private randomDistanceTexture: Texture | undefined

  public create (direction: LinkDirection): void {
    const { device, store: { pointsTextureSize, linksTextureSize }, data } = this
    if (!pointsTextureSize || !linksTextureSize) return

    this.linkFirstIndicesAndAmount = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
    this.indices = new Float32Array(linksTextureSize * linksTextureSize * 4)
    const linkBiasAndStrengthState = new Float32Array(linksTextureSize * linksTextureSize * 4)
    const linkDistanceState = new Float32Array(linksTextureSize * linksTextureSize * 4)

    const grouped = direction === LinkDirection.INCOMING ? data.sourceIndexToTargetIndices : data.targetIndexToSourceIndices
    this.maxPointDegree = 0
    let linkIndex = 0
    grouped?.forEach((connectedPointIndices, pointIndex) => {
      if (connectedPointIndices) {
        this.linkFirstIndicesAndAmount[pointIndex * 4 + 0] = linkIndex % linksTextureSize
        this.linkFirstIndicesAndAmount[pointIndex * 4 + 1] = Math.floor(linkIndex / linksTextureSize)
        this.linkFirstIndicesAndAmount[pointIndex * 4 + 2] = connectedPointIndices.length ?? 0

        connectedPointIndices.forEach(([connectedPointIndex, initialLinkIndex]) => {
          this.indices[linkIndex * 4 + 0] = connectedPointIndex % pointsTextureSize
          this.indices[linkIndex * 4 + 1] = Math.floor(connectedPointIndex / pointsTextureSize)
          const degree = data.degree?.[connectedPointIndex] ?? 0
          const connectedDegree = data.degree?.[pointIndex] ?? 0
          const degreeSum = degree + connectedDegree
          // Prevent division by zero
          const bias = degreeSum !== 0 ? degree / degreeSum : 0.5
          const minDegree = Math.min(degree, connectedDegree)
          // Prevent division by zero
          let strength = data.linkStrength?.[initialLinkIndex] ?? (1 / Math.max(minDegree, 1))
          strength = Math.sqrt(strength)
          linkBiasAndStrengthState[linkIndex * 4 + 0] = bias
          linkBiasAndStrengthState[linkIndex * 4 + 1] = strength
          linkDistanceState[linkIndex * 4] = this.store.getRandomFloat(0, 1)

          linkIndex += 1
        })

        this.maxPointDegree = Math.max(this.maxPointDegree, connectedPointIndices.length ?? 0)
      }
    })

    // Recreate textures if sizes changed
    const recreatePointTextures =
      !this.linkFirstIndicesAndAmountTexture ||
      this.linkFirstIndicesAndAmountTexture.width !== pointsTextureSize ||
      this.linkFirstIndicesAndAmountTexture.height !== pointsTextureSize

    const recreateLinkTextures =
      !this.indicesTexture ||
      this.indicesTexture.width !== linksTextureSize ||
      this.indicesTexture.height !== linksTextureSize

    if (recreatePointTextures) {
      if (this.linkFirstIndicesAndAmountTexture && !this.linkFirstIndicesAndAmountTexture.destroyed) {
        this.linkFirstIndicesAndAmountTexture.destroy()
      }
      this.linkFirstIndicesAndAmountTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.COPY_DST,
      })
    }
    this.linkFirstIndicesAndAmountTexture!.copyImageData({
      data: this.linkFirstIndicesAndAmount,
      bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    })

    if (recreateLinkTextures) {
      if (this.indicesTexture && !this.indicesTexture.destroyed) this.indicesTexture.destroy()
      if (this.biasAndStrengthTexture && !this.biasAndStrengthTexture.destroyed) this.biasAndStrengthTexture.destroy()
      if (this.randomDistanceTexture && !this.randomDistanceTexture.destroyed) this.randomDistanceTexture.destroy()

      this.indicesTexture = device.createTexture({
        width: linksTextureSize,
        height: linksTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.COPY_DST,
      })
      this.biasAndStrengthTexture = device.createTexture({
        width: linksTextureSize,
        height: linksTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.COPY_DST,
      })
      this.randomDistanceTexture = device.createTexture({
        width: linksTextureSize,
        height: linksTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.COPY_DST,
      })
    }

    this.indicesTexture!.copyImageData({
      data: this.indices,
      bytesPerRow: getBytesPerRow('rgba32float', linksTextureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    })
    this.biasAndStrengthTexture!.copyImageData({
      data: linkBiasAndStrengthState,
      bytesPerRow: getBytesPerRow('rgba32float', linksTextureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    })
    this.randomDistanceTexture!.copyImageData({
      data: linkDistanceState,
      bytesPerRow: getBytesPerRow('rgba32float', linksTextureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    })

    // Force shader rebuild if degree changed
    if (this.previousMaxPointDegree !== undefined && this.previousMaxPointDegree !== this.maxPointDegree) {
      this.runCommand?.destroy()
      this.runCommand = undefined
    }

    this.previousMaxPointDegree = this.maxPointDegree
    this.previousPointsTextureSize = pointsTextureSize
    this.previousLinksTextureSize = linksTextureSize
  }

  public initPrograms (): void {
    const { device, store, points } = this
    if (!points || !store.pointsTextureSize || !store.linksTextureSize) return
    if (!this.linkFirstIndicesAndAmountTexture || !this.indicesTexture || !this.biasAndStrengthTexture || !this.randomDistanceTexture) return

    this.vertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    this.uniformStore ||= new UniformStore({
      forceLinkUniforms: {
        uniformTypes: {
          linkSpring: 'f32',
          linkDistance: 'f32',
          linkDistRandomVariationRange: 'vec2<f32>',
          pointsTextureSize: 'f32',
          linksTextureSize: 'f32',
          alpha: 'f32',
        },
      },
    })

    this.runCommand ||= new Model(device, {
      fs: forceFrag(this.maxPointDegree),
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
        forceLinkUniforms: this.uniformStore.getManagedUniformBuffer(device, 'forceLinkUniforms'),
        positionsTexture: points.previousPositionTexture!,
        linkInfoTexture: this.linkFirstIndicesAndAmountTexture,
        linkIndicesTexture: this.indicesTexture,
        linkPropertiesTexture: this.biasAndStrengthTexture,
        linkRandomDistanceTexture: this.randomDistanceTexture,
      },
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })
  }

  public run (renderPass?: RenderPass): void {
    const { device, store, points } = this
    if (!points || !this.runCommand || !this.uniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!this.linkFirstIndicesAndAmountTexture || !this.indicesTexture || !this.biasAndStrengthTexture || !this.randomDistanceTexture) return
    if (!renderPass && (!points.velocityFbo || points.velocityFbo.destroyed)) return

    // Skip if sizes changed and create() wasn't called again
    if (
      store.pointsTextureSize !== this.previousPointsTextureSize ||
      store.linksTextureSize !== this.previousLinksTextureSize
    ) {
      return
    }

    this.uniformStore.setUniforms({
      forceLinkUniforms: {
        linkSpring: this.config.simulationLinkSpring ?? 0,
        linkDistance: this.config.simulationLinkDistance ?? 0,
        linkDistRandomVariationRange: [
          this.config.simulationLinkDistRandomVariationRange?.[0] ?? 0,
          this.config.simulationLinkDistRandomVariationRange?.[1] ?? 0,
        ],
        pointsTextureSize: store.pointsTextureSize,
        linksTextureSize: store.linksTextureSize,
        alpha: store.alpha,
      },
    })

    this.runCommand.setBindings({
      forceLinkUniforms: this.uniformStore.getManagedUniformBuffer(device, 'forceLinkUniforms'),
      positionsTexture: points.previousPositionTexture!,
      linkInfoTexture: this.linkFirstIndicesAndAmountTexture,
      linkIndicesTexture: this.indicesTexture,
      linkPropertiesTexture: this.biasAndStrengthTexture,
      linkRandomDistanceTexture: this.randomDistanceTexture,
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
    this.runCommand?.destroy()
    this.runCommand = undefined

    // 2. Destroy Framebuffers (before textures they reference)
    // ForceLink has no framebuffers

    // 3. Destroy Textures
    if (this.linkFirstIndicesAndAmountTexture && !this.linkFirstIndicesAndAmountTexture.destroyed) {
      this.linkFirstIndicesAndAmountTexture.destroy()
    }
    this.linkFirstIndicesAndAmountTexture = undefined
    if (this.indicesTexture && !this.indicesTexture.destroyed) {
      this.indicesTexture.destroy()
    }
    this.indicesTexture = undefined
    if (this.biasAndStrengthTexture && !this.biasAndStrengthTexture.destroyed) {
      this.biasAndStrengthTexture.destroy()
    }
    this.biasAndStrengthTexture = undefined
    if (this.randomDistanceTexture && !this.randomDistanceTexture.destroyed) {
      this.randomDistanceTexture.destroy()
    }
    this.randomDistanceTexture = undefined

    // 4. Destroy UniformStores (Models already destroyed their managed uniform buffers)
    this.uniformStore?.destroy()
    this.uniformStore = undefined

    // 5. Destroy Buffers (passed via attributes - NOT owned by Models, must destroy manually)
    if (this.vertexCoordBuffer && !this.vertexCoordBuffer.destroyed) {
      this.vertexCoordBuffer.destroy()
    }
    this.vertexCoordBuffer = undefined
  }
}
