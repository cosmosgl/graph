/**
 * ZoomPan - Unified zoom/pan class using shared store
 *
 * Combines all zoom/pan logic and values in one class that uses
 * shared values from an independent store.
 */

import { mat3 } from 'gl-matrix'
import { ViewTransform } from './matrix-utils'
import { SharedStore } from './shared-store'
import { BouncingDisksAppConfig } from './app'

export class ZoomPan {
  // Shared store reference
  private store: SharedStore

  // Canvas and event handling
  private canvas?: HTMLCanvasElement
  private enableWheelZoom: boolean
  private enableDragPan: boolean
  private wheelZoomSensitivity: number
  private minZoom: number
  private maxZoom: number
  private onChange?: (matrix: Float32Array) => void

  // Transform state
  private viewTransform: ViewTransform
  private transform = mat3.create()

  // Event handling state
  private isDragging = false
  private lastX = 0
  private lastY = 0
  private originalCursor: string = 'default'

  // Bound event handlers for cleanup
  private boundHandleWheel: (e: WheelEvent) => void
  private boundHandleMouseDown: (e: MouseEvent) => void
  private boundHandleMouseMove: (e: MouseEvent) => void
  private boundHandleMouseUp: () => void
  private boundHandleMouseLeave: () => void

  public constructor (store: SharedStore, config: BouncingDisksAppConfig & {
    onChange?: (matrix: Float32Array) => void;
  }) {
    this.store = store
    this.canvas = store.canvas
    this.enableWheelZoom = config.enableWheelZoom ?? true
    this.enableDragPan = config.enableDragPan ?? true
    this.wheelZoomSensitivity = config.wheelZoomSensitivity ?? 0.1
    this.minZoom = config.minZoom ?? 0.001
    this.maxZoom = config.maxZoom ?? 10
    this.onChange = config.onChange

    // Initialize view transform
    this.viewTransform = new ViewTransform()

    // Bind event handlers
    this.boundHandleWheel = this.handleWheel.bind(this)
    this.boundHandleMouseDown = this.handleMouseDown.bind(this)
    this.boundHandleMouseMove = this.handleMouseMove.bind(this)
    this.boundHandleMouseUp = this.handleMouseUp.bind(this)
    this.boundHandleMouseLeave = this.handleMouseLeave.bind(this)

    // Attach to canvas if provided
    if (this.canvas) {
      this.attachToCanvas(this.canvas)
    }
  }

  /**
   * Attach event listeners to a canvas
   */
  public attachToCanvas (canvas: HTMLCanvasElement): void {
    this.detachFromCanvas() // Clean up previous attachment
    this.canvas = canvas

    if (this.enableWheelZoom) {
      canvas.addEventListener('wheel', this.boundHandleWheel, { passive: false })
    }

    if (this.enableDragPan) {
      canvas.addEventListener('mousedown', this.boundHandleMouseDown)
      canvas.addEventListener('mousemove', this.boundHandleMouseMove)
      canvas.addEventListener('mouseup', this.boundHandleMouseUp)
      canvas.addEventListener('mouseleave', this.boundHandleMouseLeave)

      // Set initial cursor
      this.originalCursor = canvas.style.cursor || 'default'
      canvas.style.cursor = 'grab'
    }
  }

  /**
   * Detach event listeners from current canvas
   */
  public detachFromCanvas (): void {
    if (!this.canvas) return

    this.canvas.removeEventListener('wheel', this.boundHandleWheel)
    this.canvas.removeEventListener('mousedown', this.boundHandleMouseDown)
    this.canvas.removeEventListener('mousemove', this.boundHandleMouseMove)
    this.canvas.removeEventListener('mouseup', this.boundHandleMouseUp)
    this.canvas.removeEventListener('mouseleave', this.boundHandleMouseLeave)

    // Restore original cursor
    this.canvas.style.cursor = this.originalCursor
    this.isDragging = false

    this.canvas = undefined
  }

  // Public API - Zoom/Pan control

  /**
   * Set zoom level (absolute)
   */
  public setZoom (scale: number): void {
    this.viewTransform.setZoom(Math.max(this.minZoom, Math.min(this.maxZoom, scale)))
    this.updateTransform()
  }

  /**
   * Zoom by a relative amount
   */
  public zoomBy (delta: number): void {
    this.viewTransform.zoomBy(delta)
    this.viewTransform.k = Math.max(this.minZoom, Math.min(this.maxZoom, this.viewTransform.k))
    this.updateTransform()
  }

  /**
   * Set pan position (absolute)
   */
  public setPan (x: number, y: number): void {
    this.viewTransform.setPan(x, y)
    this.updateTransform()
  }

  /**
   * Pan by a relative amount
   */
  public panBy (dx: number, dy: number): void {
    this.viewTransform.panBy(dx, dy)
    this.updateTransform()
  }

  /**
   * Zoom to a specific point
   */
  public zoomToPoint (scale: number, centerX: number = 0, centerY: number = 0): void {
    this.viewTransform.zoomToPoint(Math.max(this.minZoom, Math.min(this.maxZoom, scale)), centerX, centerY)
    this.updateTransform()
  }

  /**
   * Reset to identity
   */
  public reset (): void {
    this.viewTransform.reset()
    this.updateTransform()
  }

  /**
   * Get current zoom level
   */
  public getZoomLevel (): number {
    return this.viewTransform.k
  }

  /**
   * Get current pan position
   */
  public getPanPosition (): { x: number; y: number } {
    return { x: this.viewTransform.x, y: this.viewTransform.y }
  }

  /**
   * Get current view matrix (for WebGPU)
   */
  public getMatrix (): Float32Array {
    return this.viewTransform.getMatrix()
  }

  /**
   * Fit view to show all given normalized positions
   */
  public fitToPositions (positions: [number, number][], scale?: number, padding = 0.1): void {
    if (positions.length === 0) return

    const [width, height] = this.store.screenSize
    if (width === 0 || height === 0) return

    // Calculate extent of normalized positions
    let minX = Infinity; let maxX = -Infinity
    let minY = Infinity; let maxY = -Infinity

    for (const [x, y] of positions) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }

    // Adjust for single point
    if (minX === maxX) {
      minX -= 0.1
      maxX += 0.1
    }
    if (minY === maxY) {
      minY -= 0.1
      maxY += 0.1
    }

    // Calculate scale to fit
    const xScale = (width * (1 - padding * 2)) / ((maxX - minX) * width)
    const yScale = (height * (1 - padding * 2)) / ((maxY - minY) * height)
    const clampedScale = Math.max(this.minZoom, Math.min(this.maxZoom, scale ?? Math.min(xScale, yScale)))

    // Calculate center
    const centerX = (maxX + minX) / 2
    const centerY = (maxY + minY) / 2

    // Calculate translation to center
    const translateX = width / 2 - centerX * width * clampedScale
    const translateY = height / 2 - centerY * height * clampedScale

    this.viewTransform.x = translateX
    this.viewTransform.y = translateY
    this.viewTransform.k = clampedScale
    this.updateTransform()
  }

  /**
   * Destroy the zoom/pan and clean up
   */
  public destroy (): void {
    this.detachFromCanvas()

    // Clear bound handler references to prevent memory leaks
    this.boundHandleWheel = undefined as any
    this.boundHandleMouseDown = undefined as any
    this.boundHandleMouseMove = undefined as any
    this.boundHandleMouseUp = undefined as any
    this.boundHandleMouseLeave = undefined as any
  }

  /**
   * Update the transform matrix from ViewTransform state
   * Uses shared store values for screen size
   */
  private updateTransform (): void {
    const [width, height] = this.store.screenSize
    if (width === 0 || height === 0) return

    const { x, y, k } = this.viewTransform

    // Build transformation chain (like Cosmos):
    // 1. Project to screen coordinates
    // 2. Translate by pan (x, y)
    // 3. Scale by zoom (k)
    // 4. Center and normalize
    mat3.projection(this.transform, width, height)
    mat3.translate(this.transform, this.transform, [x, y])
    mat3.scale(this.transform, this.transform, [k, k])
    mat3.translate(this.transform, this.transform, [width / 2, height / 2])
    mat3.scale(this.transform, this.transform, [width / 2, height / 2])
    mat3.scale(this.transform, this.transform, [1, -1])

    // Notify change callback
    this.notifyChange()
  }

  /**
   * Notify change callback
   */
  private notifyChange (): void {
    const matrix = this.viewTransform.getMatrix()
    this.onChange?.(matrix)
  }

  // Event handlers

  /**
   * Handle mouse wheel events (zoom)
   */
  private handleWheel (e: WheelEvent): void {
    e.preventDefault()

    if (!this.canvas) return

    // Get mouse position in normalized coords (-1 to 1)
    const rect = this.canvas.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1)

    // Calculate zoom delta
    const zoomFactor = e.deltaY > 0 ? (1 - this.wheelZoomSensitivity) : (1 + this.wheelZoomSensitivity)
    const newZoom = this.viewTransform.k * zoomFactor

    // Zoom to mouse position
    this.zoomToPoint(newZoom, mouseX, mouseY)
  }

  /**
   * Handle mouse down events (start drag)
   */
  private handleMouseDown (e: MouseEvent): void {
    this.isDragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    if (this.canvas) {
      this.canvas.style.cursor = 'grabbing'
    }
  }

  /**
   * Handle mouse move events (pan)
   */
  private handleMouseMove (e: MouseEvent): void {
    if (!this.isDragging || !this.canvas) return

    const rect = this.canvas.getBoundingClientRect()

    // Calculate delta in normalized coords
    // Note: Using rect dimensions works correctly for delta calculations
    const dx = ((e.clientX - this.lastX) / rect.width) * 2
    const dy = -(((e.clientY - this.lastY) / rect.height) * 2)

    this.panBy(dx, dy)

    this.lastX = e.clientX
    this.lastY = e.clientY
  }

  /**
   * Handle mouse up events (end drag)
   */
  private handleMouseUp (): void {
    this.isDragging = false
    if (this.canvas) {
      this.canvas.style.cursor = 'grab'
    }
  }

  /**
   * Handle mouse leave events (cancel drag)
   */
  private handleMouseLeave (): void {
    if (this.isDragging) {
      this.isDragging = false
      if (this.canvas) {
        this.canvas.style.cursor = 'grab'
      }
    }
  }
}
