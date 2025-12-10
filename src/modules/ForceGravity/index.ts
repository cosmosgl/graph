import { Buffer, RenderPass, UniformStore } from '@luma.gl/core'
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

    if (!this.vertexCoordBuffer || this.vertexCoordBuffer.destroyed) {
      this.vertexCoordBuffer = device.createBuffer({
        data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      })
    }

    if (!this.uniformStore) {
      this.uniformStore = new UniformStore({
        forceGravityUniforms: {
          uniformTypes: {
            gravity: 'f32',
            spaceSize: 'f32',
            alpha: 'f32',
          },
        },
      })
    }

    if (!this.runCommand) {
      this.runCommand = new Model(device, {
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
          forceGravityUniforms: this.uniformStore.getManagedUniformBuffer(device, 'forceGravityUniforms'),
          positionsTexture: points.previousPositionTexture!,
        },
        parameters: {
          depthWriteEnabled: false,
          depthCompare: 'always',
        },
      })
    }
  }

  public run (renderPass?: RenderPass): void {
    const { device, points, store } = this
    if (!points || !this.runCommand || !this.uniformStore) return
    if (!points.previousPositionTexture || points.previousPositionTexture.destroyed) return
    if (!renderPass && (!points.velocityFbo || points.velocityFbo.destroyed)) return

    this.uniformStore.setUniforms({
      forceGravityUniforms: {
        gravity: this.config.simulationGravity ?? 0,
        spaceSize: store.adjustedSpaceSize ?? 0,
        alpha: store.alpha,
      },
    })

    this.runCommand.setBindings({
      forceGravityUniforms: this.uniformStore.getManagedUniformBuffer(device, 'forceGravityUniforms'),
      positionsTexture: points.previousPositionTexture!,
    })

    const pass = renderPass ?? device.beginRenderPass({
      framebuffer: points.velocityFbo,
    })

    this.runCommand.draw(pass)

    if (!renderPass) pass.end()
  }

  public destroy (): void {
    this.uniformStore?.destroy()
    this.uniformStore = undefined

    if (this.runCommand && !this.runCommand.destroyed) this.runCommand.destroy()
    this.runCommand = undefined

    if (this.vertexCoordBuffer && !this.vertexCoordBuffer.destroyed) {
      this.vertexCoordBuffer.destroy()
    }
    this.vertexCoordBuffer = undefined
  }
}
