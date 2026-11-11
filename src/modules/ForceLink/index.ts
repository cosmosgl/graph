import { Buffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule, BASE_PIPELINE_PARAMETERS } from '@/graph/modules/core-module'

import { forceFrag } from '@/graph/modules/ForceLink/force-spring'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'
import { ensureVec2 } from '@/graph/modules/Shared/uniform-utils'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export enum LinkDirection {
  OUTGOING = 'outgoing',
  INCOMING = 'incoming'
}

export class ForceLink extends CoreModule {
  private linkFirstIndicesAndAmount: Float32Array = new Float32Array()
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
      linksTextureSize: number;
      alpha: number;
      collisionRadius: number;
      collisionPadding: number;
      useCollisionRadii: number;
    };
  }> | undefined

  private linkFirstIndicesAndAmountTexture: Texture | undefined
  private neighborAndSpringTexture: Texture | undefined
  private randomDistanceTexture: Texture | undefined

  public create (direction: LinkDirection): void {
    const { device, store: { pointsTextureSize, linksTextureSize }, data } = this
    if (!pointsTextureSize || !linksTextureSize) return

    this.linkFirstIndicesAndAmount = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
    const linkTexelCount = linksTextureSize * linksTextureSize
    const neighborAndSpringState = new Float32Array(linkTexelCount * 4)
    const linkDistanceState = new Float32Array(linkTexelCount)

    const linksByPoint = direction === LinkDirection.INCOMING ? data.linksBySource : data.linksByTarget
    this.maxPointDegree = 0
    if (linksByPoint) {
      const { offsets, neighbors, linkIndices } = linksByPoint
      for (let pointIndex = 0; pointIndex < offsets.length - 1; pointIndex++) {
        const firstLinkIndex = offsets[pointIndex] as number
        const endLinkIndex = offsets[pointIndex + 1] as number
        const amount = endLinkIndex - firstLinkIndex
        if (amount === 0) continue
        this.linkFirstIndicesAndAmount[pointIndex * 4 + 0] = firstLinkIndex % linksTextureSize
        this.linkFirstIndicesAndAmount[pointIndex * 4 + 1] = Math.floor(firstLinkIndex / linksTextureSize)
        this.linkFirstIndicesAndAmount[pointIndex * 4 + 2] = amount

        for (let linkIndex = firstLinkIndex; linkIndex < endLinkIndex; linkIndex++) {
          const connectedPointIndex = neighbors[linkIndex] as number
          const initialLinkIndex = linkIndices[linkIndex] as number
          const texelOffset = linkIndex * 4
          neighborAndSpringState[texelOffset] = connectedPointIndex % pointsTextureSize
          neighborAndSpringState[texelOffset + 1] = Math.floor(connectedPointIndex / pointsTextureSize)
          const degree = data.degree?.[connectedPointIndex] ?? 0
          const connectedDegree = data.degree?.[pointIndex] ?? 0
          const degreeSum = degree + connectedDegree
          // Prevent division by zero
          const bias = degreeSum !== 0 ? degree / degreeSum : 0.5
          const minDegree = Math.min(degree, connectedDegree)
          // Strength must reach the texture finite and non-negative — Math.sqrt emits
          // NaN otherwise, which turns the link pull on both of its points NaN — and
          // update-position drops a non-finite step, so neither would ever move by
          // any of its links.
          let strength = data.linkStrength?.[initialLinkIndex]
          if (strength === undefined || !Number.isFinite(strength) || strength < 0) {
            strength = 1 / Math.max(minDegree, 1) // max() prevents division by zero
          }
          neighborAndSpringState[texelOffset + 2] = bias
          neighborAndSpringState[texelOffset + 3] = Math.sqrt(strength)
          linkDistanceState[linkIndex] = this.store.getRandomFloat(0, 1)
        }

        this.maxPointDegree = Math.max(this.maxPointDegree, amount)
      }
    }

    // Recreate textures if sizes changed
    const recreatePointTextures =
      !this.linkFirstIndicesAndAmountTexture ||
      this.linkFirstIndicesAndAmountTexture.width !== pointsTextureSize ||
      this.linkFirstIndicesAndAmountTexture.height !== pointsTextureSize

    const recreateLinkTextures =
      !this.neighborAndSpringTexture ||
      !this.randomDistanceTexture ||
      this.neighborAndSpringTexture.destroyed ||
      this.neighborAndSpringTexture.width !== linksTextureSize ||
      this.neighborAndSpringTexture.height !== linksTextureSize ||
      this.randomDistanceTexture.destroyed

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
      if (this.neighborAndSpringTexture && !this.neighborAndSpringTexture.destroyed) this.neighborAndSpringTexture.destroy()
      if (this.randomDistanceTexture && !this.randomDistanceTexture.destroyed) this.randomDistanceTexture.destroy()

      this.neighborAndSpringTexture = device.createTexture({
        width: linksTextureSize,
        height: linksTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.COPY_DST,
      })
      this.randomDistanceTexture = device.createTexture({
        width: linksTextureSize,
        height: linksTextureSize,
        format: 'r32float',
        usage: Texture.SAMPLE | Texture.COPY_DST,
      })
    }

    this.neighborAndSpringTexture!.copyImageData({
      data: neighborAndSpringState,
      bytesPerRow: getBytesPerRow('rgba32float', linksTextureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    })
    this.randomDistanceTexture!.copyImageData({
      data: linkDistanceState,
      bytesPerRow: getBytesPerRow('r32float', linksTextureSize),
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
    if (!this.linkFirstIndicesAndAmountTexture || !this.neighborAndSpringTexture || !this.randomDistanceTexture) return

    this.vertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    this.uniformStore ||= new UniformStore(device, {
      forceLinkUniforms: {
        uniformTypes: {
          linkSpring: 'f32',
          linkDistance: 'f32',
          linkDistRandomVariationRange: 'vec2<f32>',
          linksTextureSize: 'f32',
          alpha: 'f32',
          collisionRadius: 'f32',
          collisionPadding: 'f32',
          useCollisionRadii: 'f32',
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
        // Create uniform buffer binding
        // Update it later by calling uniformStore.setUniforms()
        forceLinkUniforms: this.uniformStore.getManagedUniformBuffer('forceLinkUniforms'),
        // All texture bindings will be set dynamically in run() method
      },
      parameters: BASE_PIPELINE_PARAMETERS,
    })
  }

  /**
   * Runs one spring pass into the velocity texture.
   *
   * @param collisionSizeTexture - The collision force's resolved-size texture.
   *   When given (collision is on), each spring's rest length is floored at the
   *   two endpoints' contact distance so the spring never demands overlap.
   */
  public run (collisionSizeTexture?: Texture): void {
    const { device, store, points, config } = this
    if (!points) return
    if (!this.runCommand || !this.uniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.exitTexture || points.exitTexture.destroyed) return
    if (!this.linkFirstIndicesAndAmountTexture || !this.neighborAndSpringTexture || !this.randomDistanceTexture) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return

    // Skip if sizes changed and create() wasn't called again
    if (
      store.pointsTextureSize !== this.previousPointsTextureSize ||
      store.linksTextureSize !== this.previousLinksTextureSize
    ) {
      return
    }

    const useCollisionRadii = (config.simulationCollision ?? 0) > 0 &&
      collisionSizeTexture !== undefined && !collisionSizeTexture.destroyed

    this.uniformStore.setUniforms({
      forceLinkUniforms: {
        linkSpring: config.simulationLinkSpring,
        linkDistance: config.simulationLinkDistance,
        linkDistRandomVariationRange: ensureVec2(config.simulationLinkDistRandomVariationRange, [0, 0]),
        linksTextureSize: store.linksTextureSize,
        alpha: store.alpha,
        collisionRadius: config.simulationCollisionRadius ?? 0,
        collisionPadding: config.simulationCollisionPadding ?? 0,
        useCollisionRadii: useCollisionRadii ? 1 : 0,
      },
    })

    this.runCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      exitTexture: points.exitTexture,
      linkInfoTexture: this.linkFirstIndicesAndAmountTexture,
      linkNeighborAndSpringTexture: this.neighborAndSpringTexture,
      linkRandomDistanceTexture: this.randomDistanceTexture,
      // A sampler must be bound even when the shader never reads it; the
      // positions texture stands in while collision is off.
      sizeTexture: useCollisionRadii ? collisionSizeTexture : points.previousPositionTexture,
    })

    const pass = device.beginRenderPass({
      framebuffer: points.velocityFbo,
      clearColor: [0, 0, 0, 0],
    })
    this.runCommand.draw(pass)
    pass.end()
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
    if (this.neighborAndSpringTexture && !this.neighborAndSpringTexture.destroyed) {
      this.neighborAndSpringTexture.destroy()
    }
    this.neighborAndSpringTexture = undefined
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
