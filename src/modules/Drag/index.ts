import { drag } from 'd3-drag'
import { Store } from '@/graph/modules/Store'
import { type GraphConfigInterface } from '@/graph/config'
import { Transition } from '@/graph/modules/Transition'

export class Drag {
  public readonly store: Store
  public readonly config: GraphConfigInterface
  public readonly transition: Transition
  public isActive = false
  public behavior = drag<HTMLCanvasElement, undefined>()
    .subject((event) => {
      if (this.transition.isActive) return undefined
      return this.store.hoveredPoint && !this.store.isSpaceKeyPressed ? { x: event.x, y: event.y } : undefined
    })
    .on('start', (e) => {
      if (this.store.hoveredPoint) {
        this.store.draggingPointIndex = this.store.hoveredPoint.index
        this.isActive = true
        this.config.onDragStart?.(e)
      }
    })
    .on('drag', (e) => {
      this.config.onDrag?.(e)
    })
    .on('end', (e) => {
      this.isActive = false
      this.store.draggingPointIndex = undefined
      this.config.onDragEnd?.(e)
    })

  public constructor (store: Store, config: GraphConfigInterface, transition: Transition) {
    this.store = store
    this.config = config
    this.transition = transition
  }
}
