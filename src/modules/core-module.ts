import { Device, type RenderPipelineParameters } from '@luma.gl/core'
import { type GraphConfigInterface } from '@/graph/config'
import { GraphData } from '@/graph/modules/GraphData'
import { Points } from '@/graph/modules/Points'
import { Store } from '@/graph/modules/Store'

/**
 * Pipeline state for a pass that overwrites data, not color, in a float texture:
 * no blending, no depth, no stencil, no culling — everything a pipeline can
 * declare. Such a pass declares it itself, so it is correct inside a host-state
 * wrapper and reached from an entry point that has none alike; luma applies it
 * around the draw and restores the state after. A pass that blends additively or
 * depth-tests declares its own blend and depth instead, and the link index pass
 * its culling as well. The scissor test and the colour mask have no pipeline
 * parameter; only the wrapper resets those.
 */
export const DATA_PASS_PARAMETERS: RenderPipelineParameters = Object.freeze({
  blend: false,
  depthWriteEnabled: false,
  depthCompare: 'always',
  stencilCompare: 'always',
  cullMode: 'none',
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
