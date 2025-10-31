import regl from 'regl'
import { GraphConfigInterface } from '@/graph/config'
import { GraphData } from '@/graph/modules/GraphData'
import { Points } from '@/graph/modules/Points'
import { Store } from '@/graph/modules/Store'
import { Device } from '@luma.gl/core'

export class CoreModule {
  public readonly reglInstance: regl.Regl
  public readonly device: Device
  public readonly config: GraphConfigInterface
  public readonly store: Store
  public readonly data: GraphData
  public readonly points: Points | undefined
  public _debugRandomNumber = Math.floor(Math.random() * 1000)

  public constructor (
    reglInstance: regl.Regl,
    config: GraphConfigInterface,
    store: Store,
    data: GraphData,
    points?: Points
  ) {
    this.reglInstance = reglInstance
    this.config = config
    this.store = store
    this.data = data
    if (points) this.points = points
  }
}
