import { Buffer, RenderPass, UniformStore } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { CoreModule } from '@/graph/modules/core-module'
import forceFrag from '@/graph/modules/ForceMouse/force-mouse.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export class ForceMouse extends CoreModule {
  private runCommand: Model | undefined
  private vertexCoordBuffer: Buffer | undefined
  private uniformStore: UniformStore<{
    forceMouseUniforms: {
      repulsion: number;
      mousePos: [number, number];
    };
  }> | undefined

  public initPrograms (): void {
    const { device, points } = this
    if (!points) return

    this.vertexCoordBuffer ||= device.createBuffer({
      data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    })

    this.uniformStore ||= new UniformStore({
      forceMouseUniforms: {
        uniformTypes: {
          repulsion: 'f32',
          mousePos: 'vec2<f32>',
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
        forceMouseUniforms: this.uniformStore.getManagedUniformBuffer(device, 'forceMouseUniforms'),
        // All texture bindings will be set dynamically in run() method
      },
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })
  }

  public run (renderPass?: RenderPass): void {
    const { device, points, store } = this
    if (!points || !this.runCommand || !this.uniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!renderPass && (!points.velocityFbo || points.velocityFbo.destroyed)) return

    this.uniformStore.setUniforms({
      forceMouseUniforms: {
        repulsion: this.config.simulationRepulsionFromMouse ?? 0,
        mousePos: [store.mousePosition[0] ?? 0, store.mousePosition[1] ?? 0],
      },
    })

    // Update texture bindings dynamically
    this.runCommand.setBindings({
      positionsTexture: points.previousPositionTexture,
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
    // ForceMouse has no framebuffers

    // 3. Destroy Textures
    // ForceMouse has no textures

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
