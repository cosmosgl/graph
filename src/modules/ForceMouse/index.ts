import regl from 'regl'
import { CoreModule } from '@/graph/modules/core-module'
import forceFrag from '@/graph/modules/ForceMouse/force-mouse.frag?raw'
import { createQuadBuffer } from '@/graph/modules/Shared/buffer'
import updateVert from '@/graph/modules/Shared/quad.vert?raw'

export class ForceMouse extends CoreModule {
  private runCommand: regl.DrawCommand | undefined

  public initPrograms (): void {
    const { reglInstance, config, store, points } = this
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
          mousePos: () => store.mousePosition,
          repulsion: () => config.simulationRepulsionFromMouse,
        },
      })
    }
  }

  public run (): void {
    this.runCommand?.()
  }
}
