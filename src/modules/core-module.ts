import { Device, type RenderPipelineParameters } from '@luma.gl/core'
import { type GraphConfigInterface } from '@/graph/config'
import { GraphData } from '@/graph/modules/GraphData'
import { Points } from '@/graph/modules/Points'
import { Store } from '@/graph/modules/Store'

/**
 * The neutral pipeline state: no blending, no depth, no stencil, no culling,
 * counter-clockwise winding — every state a pipeline can declare that changes
 * what cosmos draws. Every model declares it: a pass that overwrites data uses it
 * as is, and every other model spreads it first and overrides its own blend,
 * depth or culling. A model is then correct against whatever state the host left,
 * inside a host-state wrapper and reached from an entry point that has none alike;
 * luma applies it around the draw and restores the state after. The scissor test
 * and the colour mask have no pipeline parameter; only the wrapper resets those.
 */
export const BASE_PIPELINE_PARAMETERS: RenderPipelineParameters = Object.freeze({
  blend: false,
  depthWriteEnabled: false,
  depthCompare: 'always',
  stencilCompare: 'always',
  cullMode: 'none',
  frontFace: 'ccw',
})

export class CoreModule {
  public readonly device: Device
  public readonly config: GraphConfigInterface
  public readonly store: Store
  public readonly data: GraphData
  public readonly points: Points | undefined
  public _debugRandomNumber = Math.floor(Math.random() * 1000)

  public constructor (
    device: Device,
    config: GraphConfigInterface,
    store: Store,
    data: GraphData,
    points?: Points
  ) {
    this.device = device
    this.config = config
    this.store = store
    this.data = data
    if (points) this.points = points
  }
}
