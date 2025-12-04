import regl from 'regl'
import { CoreModule } from '@/graph/modules/core-module'
import calculateCentermassFrag from '@/graph/modules/ForceCenter/calculate-centermass.frag?raw'
import calculateCentermassVert from '@/graph/modules/ForceCenter/calculate-centermass.vert?raw'
import forceFrag from '@/graph/modules/ForceCenter/force-center.frag?raw'
import { createQuadBuffer, createIndexesForBuffer } from '@/graph/modules/Shared/buffer'
import clearFrag from '@/graph/modules/Shared/clear.frag?raw'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export class ForceCenter extends CoreModule {
  private centermassFbo: regl.Framebuffer2D | undefined
  private clearCentermassCommand: regl.DrawCommand | undefined
  private calculateCentermassCommand: regl.DrawCommand | undefined
  private runCommand: regl.DrawCommand | undefined
  private centermassTexture: regl.Texture2D | undefined
  private pointIndices: regl.Buffer | undefined

  public create (): void {
    const { reglInstance, store } = this
    if (!this.centermassTexture) this.centermassTexture = reglInstance.texture()
    this.centermassTexture({
      data: new Float32Array(4).fill(0),
      shape: [1, 1, 4],
      type: 'float',
    })
    if (!this.centermassFbo) this.centermassFbo = reglInstance.framebuffer()
    this.centermassFbo({
      color: this.centermassTexture,
      depth: false,
      stencil: false,
    })

    if (!this.pointIndices) this.pointIndices = reglInstance.buffer(0)
    this.pointIndices(createIndexesForBuffer(store.pointsTextureSize))
  }

  public initPrograms (): void {
    const { reglInstance, config, store, data, points } = this
    if (!this.clearCentermassCommand) {
      this.clearCentermassCommand = reglInstance({
        frag: clearFrag,
        vert: updateVert,
        framebuffer: () => this.centermassFbo as regl.Framebuffer2D,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
      })
    }
    if (!this.calculateCentermassCommand) {
      this.calculateCentermassCommand = reglInstance({
        frag: calculateCentermassFrag,
        vert: calculateCentermassVert,
        framebuffer: () => this.centermassFbo as regl.Framebuffer2D,
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
    if (!this.runCommand) {
      this.runCommand = reglInstance({
        frag: forceFrag,
        vert: updateVert,
        framebuffer: () => points?.velocityFbo as regl.Framebuffer2D,
        primitive: 'triangle strip',
        count: 4,
        attributes: { vertexCoord: createQuadBuffer(reglInstance) },
        uniforms: {
          positionsTexture: () => points?.previousPositionFbo,
          centermassTexture: () => this.centermassFbo,
          centerForce: () => config.simulationCenter,
          alpha: () => store.alpha,
        },
      })
    }
  }

  public run (): void {
    this.clearCentermassCommand?.()
    this.calculateCentermassCommand?.()
    this.runCommand?.()
  }
}
