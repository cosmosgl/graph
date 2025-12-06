import regl from 'regl'
import { CoreModule } from '@/graph/modules/core-module'
import forceFrag from '@/graph/modules/ForceCollision/force-collision.frag'
import { createQuadBuffer } from '@/graph/modules/Shared/buffer'
import updateVert from '@/graph/modules/Shared/quad.vert'

export class ForceCollision extends CoreModule {
  private runCommand: regl.DrawCommand | undefined
  private sizeTexture: regl.Texture2D | undefined
  private sizeFbo: regl.Framebuffer2D | undefined

  public create (): void {
    const { reglInstance, store, data } = this
    if (!store.pointsTextureSize || data.pointsNumber === undefined) return

    // Create size texture for collision radius calculation
    const initialState = new Float32Array(store.pointsTextureSize * store.pointsTextureSize * 4)
    for (let i = 0; i < data.pointsNumber; i++) {
      initialState[i * 4] = data.pointSizes?.[i] ?? this.config.pointSize ?? 4
    }

    if (!this.sizeTexture) this.sizeTexture = reglInstance.texture()
    this.sizeTexture({
      data: initialState,
      width: store.pointsTextureSize,
      height: store.pointsTextureSize,
      type: 'float',
    })

    if (!this.sizeFbo) this.sizeFbo = reglInstance.framebuffer()
    this.sizeFbo({
      color: this.sizeTexture,
      depth: false,
      stencil: false,
    })
  }

  public initPrograms (): void {
    const { reglInstance, config, store, data, points } = this
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
          sizeTexture: () => this.sizeFbo,
          pointsTextureSize: () => store.pointsTextureSize,
          spaceSize: () => store.adjustedSpaceSize,
          alpha: () => store.alpha,
          collisionStrength: () => config.simulationCollision,
          collisionRadius: () => config.simulationCollisionRadius ?? 0,
          pointsNumber: () => data.pointsNumber ?? 0,
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
  }

  public run (): void {
    this.runCommand?.()
  }
}



