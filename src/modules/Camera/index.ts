import { zoom, ZoomTransform, zoomIdentity, D3ZoomEvent } from 'd3-zoom'
import { Selection } from 'd3-selection'
import { easeQuadInOut } from 'd3-ease'
import { mat4, vec3 } from 'gl-matrix'
import { Store, type Mat4Array } from '@/graph/modules/Store'
import { type GraphConfigInterface } from '@/graph/config'
import { clamp } from '@/graph/helper'

/**
 * Minimum polar angle offset from the poles (radians). Keeps the camera direction
 * from becoming parallel to the up vector, where `mat4.lookAt` is singular.
 */
const MIN_POLAR_OFFSET = 0.01

function getBoundingSphere (positions: number[] | Float32Array, dimensions: 2 | 3): { center: vec3; radius: number } {
  let minX = Infinity; let maxX = -Infinity
  let minY = Infinity; let maxY = -Infinity
  let minZ = Infinity; let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += dimensions) {
    const x = positions[i] as number
    const y = positions[i + 1] as number
    const z = dimensions === 3 ? positions[i + 2] as number : 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (minX > maxX) return { center: vec3.create(), radius: 1 }
  const center = vec3.fromValues((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
  const dx = maxX - minX
  const dy = maxY - minY
  const dz = maxZ - minZ
  const radius = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) / 2, 1e-6)
  return { center, radius }
}

/**
 * Perspective orbit camera for 3D mode.
 *
 * Owns the spherical orbit state (`target`, `distance`, `azimuth`, `polar`) and produces
 * the view-projection matrix that replaces the 2D zoom transform in `Store.transformationMatrix4x4`.
 *
 * Gestures reuse d3-zoom: transform deltas are consumed — drag rotates (or pans the target
 * while the Space key is pressed), wheel/pinch dollies via the scale factor `k`
 * (`distance = baseDistance / k`). After programmatic fits the d3-zoom state is re-seeded
 * to identity so gesture math stays consistent.
 *
 * The view matrix is rotation + translation only (no scale) — shaders rely on this to
 * extract the projection focal length from the combined view-projection matrix.
 */
export class Camera {
  public readonly store: Store
  public readonly config: GraphConfigInterface
  public isRunning = false

  /** Orbit center in space coordinates. */
  public target = vec3.create()
  /** Distance from the camera eye to `target`. */
  public distance = 1
  /** Horizontal orbit angle in radians. `0` looks down the negative z axis (2D-like view). */
  public azimuth = 0
  /** Vertical orbit angle from the +y pole in radians, clamped away from the poles. */
  public polar = Math.PI / 2

  public behavior = zoom<HTMLCanvasElement, undefined>()
    .scaleExtent([0.001, Infinity])
    .on('start', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
      this.isRunning = true
      this.config.onZoomStart?.(e, !!e.sourceEvent)
    })
    .on('zoom', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
      const transform = e.transform
      if (e.sourceEvent) {
        if (transform.k !== this.previousTransform.k) {
          // Wheel / pinch — dolly. d3-zoom also translates to keep the pointer
          // invariant, which is meaningless for an orbit, so x/y are ignored here.
          this.distance = this.baseDistance / transform.k
        } else {
          const dx = transform.x - this.previousTransform.x
          const dy = transform.y - this.previousTransform.y
          if (this.store.isSpaceKeyPressed) this.pan(dx, dy)
          else this.rotate(dx, dy)
        }
        this.updateMatrices()
      }
      // Programmatic transforms (re-seeding after fits) only sync the gesture baseline.
      this.previousTransform = transform
      this.config.onZoom?.(e, !!e.sourceEvent)
    })
    .on('end', (e: D3ZoomEvent<HTMLCanvasElement, undefined>) => {
      this.isRunning = false
      this.config.onZoomEnd?.(e, !!e.sourceEvent)
    })

  private view = mat4.create()
  private projection = mat4.create()
  private viewProjection = mat4.create()
  /** Camera distance corresponding to d3-zoom scale `k = 1`; reset on every fit. */
  private baseDistance = 1
  private previousTransform: ZoomTransform = zoomIdentity
  private aspect = 1
  /** Bounding-sphere radius of the last fitted positions; drives the automatic far plane. */
  private sceneRadius = 1

  public constructor (store: Store, config: GraphConfigInterface) {
    this.store = store
    this.config = config
  }

  public get viewProjectionMatrix (): Mat4Array {
    return Array.from(this.viewProjection) as Mat4Array
  }

  public setViewport (width: number, height: number): void {
    this.aspect = height === 0 ? 1 : width / height
    this.updateMatrices()
  }

  public setOrbit (azimuth: number, polar: number, distance: number, target: vec3): void {
    this.azimuth = azimuth
    this.polar = clamp(polar, MIN_POLAR_OFFSET, Math.PI - MIN_POLAR_OFFSET)
    this.distance = distance
    vec3.copy(this.target, target)
    this.updateMatrices()
  }

  /**
   * Places the camera at `eye` looking at the center of the given positions
   * (used by the `cameraInitialPosition` config option).
   */
  public setEyePosition (eye: [number, number, number], positions: number[] | Float32Array, dimensions: 2 | 3): void {
    const { center, radius } = getBoundingSphere(positions, dimensions)
    this.sceneRadius = radius
    const direction = vec3.sub(vec3.create(), vec3.fromValues(eye[0], eye[1], eye[2]), center)
    const distance = Math.max(vec3.length(direction), 1e-6)
    this.setOrbit(
      Math.atan2(direction[0], direction[2]),
      Math.acos(clamp(direction[1] / distance, -1, 1)),
      distance,
      center
    )
  }

  /**
   * Computes the orbit target and distance that frame the given positions,
   * keeping the current view direction.
   *
   * @param positions Flat array of point coordinates with the given stride.
   * @param dimensions Coordinates per point: `2` (`z = 0`) or `3`.
   * @param padding Padding around the viewport as a fraction of the viewport size (e.g. 0.1 = 10%).
   */
  public getFitOrbit (positions: number[] | Float32Array, dimensions: 2 | 3, padding = 0.1): { target: vec3; distance: number; radius: number } {
    const { center, radius } = getBoundingSphere(positions, dimensions)
    const fovY = this.config.cameraFov * Math.PI / 180
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * this.aspect)
    const paddingScale = clamp(1 - padding * 2, 0.1, 1)
    const distance = radius / Math.sin(Math.min(fovX, fovY) / 2) / paddingScale
    return { target: center, distance, radius }
  }

  /**
   * Frames the given positions, animating the orbit target and distance.
   * Mirrors the 2D `fitView` semantics (`easeQuadInOut`, d3 transition on the canvas).
   */
  public fitToPositions (
    selection: Selection<HTMLCanvasElement, undefined, null, undefined>,
    positions: number[] | Float32Array,
    dimensions: 2 | 3,
    padding = 0.1,
    duration = 0
  ): void {
    if (positions.length === 0) return
    const { target, distance, radius } = this.getFitOrbit(positions, dimensions, padding)
    this.sceneRadius = radius
    if (duration === 0) {
      vec3.copy(this.target, target)
      this.distance = distance
      this.updateMatrices()
      this.reseedZoomState(selection)
    } else {
      const fromTarget = vec3.clone(this.target)
      const fromDistance = this.distance
      selection
        .transition('cosmosCameraFit')
        .ease(easeQuadInOut)
        .duration(duration)
        .tween('cosmos-camera-fit', () => (t: number) => {
          vec3.lerp(this.target, fromTarget, target, t)
          this.distance = fromDistance + (distance - fromDistance) * t
          this.updateMatrices()
        })
        .on('end', () => this.reseedZoomState(selection))
    }
  }

  /**
   * Projects a 3D space position to screen coordinates.
   * @returns `[x, y]` in the screen coordinate system, or `[NaN, NaN]` if the
   * position is behind the camera.
   */
  public project (spacePosition: [number, number, number]): [number, number] {
    const [width, height] = this.store.screenSize
    const clip = [0, 0, 0, 0]
    const m = this.viewProjection
    for (let row = 0; row < 4; row += 1) {
      clip[row] = (m[row] as number) * spacePosition[0] +
        (m[4 + row] as number) * spacePosition[1] +
        (m[8 + row] as number) * spacePosition[2] +
        (m[12 + row] as number)
    }
    const w = clip[3] as number
    if (w <= 0) return [NaN, NaN]
    return [
      ((clip[0] as number) / w + 1) / 2 * width,
      (1 - (clip[1] as number) / w) / 2 * height,
    ]
  }

  /**
   * Recomputes the view, projection and view-projection matrices from the current
   * orbit state and publishes the result to the `Store`.
   */
  public updateMatrices (): void {
    const { cameraFov, cameraNear, cameraFar } = this.config
    const sinPolar = Math.sin(this.polar)
    const eye = vec3.fromValues(
      this.target[0] + this.distance * sinPolar * Math.sin(this.azimuth),
      this.target[1] + this.distance * Math.cos(this.polar),
      this.target[2] + this.distance * sinPolar * Math.cos(this.azimuth)
    )
    mat4.lookAt(this.view, eye, this.target, [0, 1, 0])
    // The far plane must cover the whole scene even when the camera dollies inside it.
    const far = cameraFar ?? Math.max((this.distance + this.sceneRadius * 2) * 2, cameraNear * 100)
    mat4.perspective(this.projection, cameraFov * Math.PI / 180, this.aspect, cameraNear, far)
    mat4.multiply(this.viewProjection, this.projection, this.view)
    this.store.viewProjection3D = this.viewProjectionMatrix
  }

  private rotate (dx: number, dy: number): void {
    const height = this.store.screenSize[1] || 1
    this.azimuth -= 2 * Math.PI * dx / height
    this.polar = clamp(this.polar - 2 * Math.PI * dy / height, MIN_POLAR_OFFSET, Math.PI - MIN_POLAR_OFFSET)
  }

  private pan (dx: number, dy: number): void {
    const height = this.store.screenSize[1] || 1
    const fovY = this.config.cameraFov * Math.PI / 180
    const worldPerPixel = 2 * this.distance * Math.tan(fovY / 2) / height
    // Camera right and up axes in world space — rows of the view rotation.
    const v = this.view
    vec3.scaleAndAdd(this.target, this.target, [v[0], v[4], v[8]], -dx * worldPerPixel)
    vec3.scaleAndAdd(this.target, this.target, [v[1], v[5], v[9]], dy * worldPerPixel)
  }

  /**
   * Resets d3-zoom to the identity transform so that `k = 1` corresponds to the
   * current camera distance. Without this, the first wheel event after a
   * programmatic fit would jump to a stale dolly level.
   */
  private reseedZoomState (selection: Selection<HTMLCanvasElement, undefined, null, undefined>): void {
    this.baseDistance = this.distance
    selection.call(this.behavior.transform, zoomIdentity)
  }
}
