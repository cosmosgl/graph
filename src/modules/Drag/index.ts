import { drag } from 'd3-drag'
import { Store } from '@/graph/modules/Store'
import { type GraphConfigInterface } from '@/graph/config'
import { Transition, TransitionProperty } from '@/graph/modules/Transition'

export class Drag {
  public readonly store: Store
  public readonly config: GraphConfigInterface
  public readonly transition: Transition
  public isActive = false
  public behavior = drag<HTMLCanvasElement, undefined>()
    .subject((event) => {
      // Block drag start while positions are animating so we don't begin dragging
      // a point whose on-screen location is still moving under the cursor.
      // TODO: Point drag can stay enabled during size transitions once hover picking
      // consumes the same interpolated point sizes as the draw pass.
      if (
        this.transition.isActiveFor(TransitionProperty.Positions) ||
        this.transition.isActiveFor(TransitionProperty.PointSizes)
      ) return undefined
      return this.store.hoveredPoint && !this.store.isSpaceKeyPressed ? { x: event.x, y: event.y } : undefined
    })
    .on('start', (e) => {
      if (this.store.hoveredPoint) {
        this.store.draggingPointIndex = this.store.hoveredPoint.index
        if (this.store.is3D && this.store.hoveredPoint.position.length === 3) {
          // In 3D the point is dragged in the camera-facing plane through its
          // position at drag start (see Camera.unprojectOnPlane).
          this.store.dragPlanePoint3D = [...this.store.hoveredPoint.position]
          this.store.mousePosition3D = [...this.store.hoveredPoint.position]
        }
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
      this.store.dragPlanePoint3D = undefined
      this.config.onDragEnd?.(e)
    })

  public constructor (store: Store, config: GraphConfigInterface, transition: Transition) {
    this.store = store
    this.config = config
    this.transition = transition
  }
}
