import { Buffer, Texture, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import { isNumber } from '@/graph/helper'
import { getBytesPerRow } from '@/graph/modules/Shared/texture-utils'

import forceFrag from '@/graph/modules/ForceAttractor/force-attractor.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

/**
 * Pulls each point toward its own attractor — a per-point layout
 * constraint that composes with the other forces instead of replacing them.
 *
 * Per point the engine uploads one texel `(targetX, targetY, strength, hasTarget)`:
 * a point whose attractor position holds `NaN` gets `hasTarget = 0` and is left
 * alone by this pass. The pull is a linear spring, like the cluster force:
 * `alpha * distance * simulationAttraction * strength`.
 */
export class ForceAttractor extends CoreModule {
  private runCommand: Model | undefined
  private vertexCoordBuffer: Buffer | undefined
  private attractorTexture: Texture | undefined
  private previousPointsTextureSize: number | undefined
  private uniformStore: UniformStore<{
    forceAttractorUniforms: {
      alpha: number;
      attractionCoefficient: number;
    };
  }> | undefined

  /** True when the current data gives at least one point an attractor, so `run()` has work to do. */
  public get isActive (): boolean {
    return this.data.pointAttractors !== undefined
  }

  public create (): void {
    const { device, store, data } = this
    const { pointsTextureSize } = store
    const { pointsNumber, pointAttractors, pointAttractorStrength } = data
    if (pointsNumber === undefined || !pointsTextureSize || pointAttractors === undefined) return

    const attractorState = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
    for (let i = 0; i < pointsNumber; ++i) {
      const x = pointAttractors[i * 2]
      const y = pointAttractors[i * 2 + 1]
      // NaN (or a missing value) in either coordinate means "no attractor".
      if (!isNumber(x) || !isNumber(y)) continue
      const strength = pointAttractorStrength?.[i]
      attractorState[i * 4 + 0] = x as number
      attractorState[i * 4 + 1] = y as number
      attractorState[i * 4 + 2] = isNumber(strength) ? (strength as number) : 1
      attractorState[i * 4 + 3] = 1
    }

    const sizeChanged = this.previousPointsTextureSize !== pointsTextureSize
    if (!this.attractorTexture || this.attractorTexture.destroyed || sizeChanged) {
      if (this.attractorTexture && !this.attractorTexture.destroyed) {
        this.attractorTexture.destroy()
      }
      this.attractorTexture = device.createTexture({
        width: pointsTextureSize,
        height: pointsTextureSize,
        format: 'rgba32float',
        usage: Texture.SAMPLE | Texture.COPY_DST,
      })
    }
    this.attractorTexture.copyImageData({
      data: attractorState,
      bytesPerRow: getBytesPerRow('rgba32float', pointsTextureSize),
      mipLevel: 0,
      x: 0,
      y: 0,
    })
    this.previousPointsTextureSize = pointsTextureSize
  }

  public initPrograms (): void {
    const { device, points, store } = this
    if (!points || !store.pointsTextureSize) return

    this.vertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    this.uniformStore ||= new UniformStore(device, {
      forceAttractorUniforms: {
        uniformTypes: {
          alpha: 'f32',
          attractionCoefficient: 'f32',
        },
      },
    })

    this.runCommand ||= new Model(device, {
      fs: forceFrag,
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
        forceAttractorUniforms: this.uniformStore.getManagedUniformBuffer('forceAttractorUniforms'),
        // All texture bindings will be set dynamically in run() method
      },
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })
  }

  public run (): void {
    const { device, points, store } = this
    if (!points || !this.isActive) return
    if (!this.runCommand || !this.uniformStore) return
    if (!this.attractorTexture || this.attractorTexture.destroyed) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return

    this.uniformStore.setUniforms({
      forceAttractorUniforms: {
        alpha: store.alpha,
        attractionCoefficient: this.config.simulationAttraction,
      },
    })

    // Update texture bindings dynamically
    this.runCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
      attractorTexture: this.attractorTexture,
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
    // ForceAttractor has no framebuffers

    // 3. Destroy Textures
    if (this.attractorTexture && !this.attractorTexture.destroyed) {
      this.attractorTexture.destroy()
    }
    this.attractorTexture = undefined
    this.previousPointsTextureSize = undefined

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
