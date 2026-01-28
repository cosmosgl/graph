import { Buffer, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import forceFrag from '@/graph/modules/ForceGravity/force-gravity.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export class ForceGravity extends CoreModule {
  private runCommand: Model | undefined
  private vertexCoordBuffer: Buffer | undefined
  private uniformStore: UniformStore<{
    forceGravityUniforms: {
      gravity: number;
      spaceSize: number;
      alpha: number;
    };
  }> | undefined

  public initPrograms (): void {
    const { device, points, store } = this
    if (!points || !store.pointsTextureSize) return

    this.vertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    this.uniformStore ||= new UniformStore({
      forceGravityUniforms: {
        uniformTypes: {
          gravity: 'f32',
          spaceSize: 'f32',
          alpha: 'f32',
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
        forceGravityUniforms: this.uniformStore.getManagedUniformBuffer(device, 'forceGravityUniforms'),
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
    if (!points) return
    if (!this.runCommand || !this.uniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!points.velocityFbo || points.velocityFbo.destroyed) return

    this.uniformStore.setUniforms({
      forceGravityUniforms: {
        gravity: this.config.simulationGravity ?? 0,
        spaceSize: store.adjustedSpaceSize ?? 0,
        alpha: store.alpha,
      },
    })

    // Update texture bindings dynamically
    this.runCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
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
    // ForceGravity has no framebuffers

    // 3. Destroy Textures
    // ForceGravity has no textures

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
