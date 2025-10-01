import { Buffer, Device } from '@luma.gl/core'
import { PointRenderer } from './point-renderer'
import { ZoomPan } from './zoom-pan'
import { SharedStore } from './shared-store'

export type OnTickCallback = () => void;

export interface BouncingDisksAppConfig {
  device: Device;
  positionBuffer: Buffer;
  instanceCount: number;
  onTick?: OnTickCallback;
  /** Enable mouse wheel zoom (default: true) */
  enableWheelZoom?: boolean;
  /** Enable click and drag pan (default: true) */
  enableDragPan?: boolean;
  /** Zoom sensitivity for wheel events (default: 0.1) */
  wheelZoomSensitivity?: number;
  /** Minimum zoom level (default: 0.001) */
  minZoom?: number;
  /** Maximum zoom level (default: 10) */
  maxZoom?: number;
  /** Scale point size with zoom level (default: false) */
  scalePointSizeWithZoom?: boolean;
}

export class BouncingDisksApp {
  private device: Device
  private pointRenderer!: PointRenderer
  private zoomPan?: ZoomPan
  private store: SharedStore
  private config: BouncingDisksAppConfig

  // Animation loop state
  private animationFrameId: number | null = null
  private isRunning: boolean = false

  // Resize observer
  private resizeObserver?: ResizeObserver

  public constructor (config: BouncingDisksAppConfig) {
    this.device = config.device
    this.config = config

    // Get canvas from device
    const canvas = this.device.canvasContext?.canvas
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Device must have an HTMLCanvasElement. Ensure the device was created with a canvas element.')
    }

    // Create internal store
    this.store = new SharedStore(canvas)

    // Set up resize handler
    this.setupResizeHandler()
  }

  public async initialize (): Promise<void> {
    // Initialize renderer with provided position buffer
    this.pointRenderer = new PointRenderer(
      this.device,
      this.config,
      this.store
    )

    // Create zoom/pan (canvas is guaranteed to exist)
    this.createZoomPan()
  }

  public start (): void {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.renderLoop()
  }

  public stop (): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  public destroy (): void {
    this.stop()
    this.pointRenderer?.destroy()
    this.zoomPan?.destroy()
    this.resizeObserver?.disconnect()
  }

  /**
   * Get the ZoomPan instance (if created)
   * Use this to control zoom/pan programmatically
   */
  public getZoomPan (): ZoomPan | undefined {
    return this.zoomPan
  }

  // Convenience methods for programmatic zoom/pan control
  // These delegate to the internal zoom/pan if it exists

  /**
   * Set zoom level (if zoom/pan exists)
   */
  public setZoom (scale: number): void {
    this.zoomPan?.setZoom(scale)
  }

  /**
   * Zoom by a relative amount (if zoom/pan exists)
   */
  public zoomBy (delta: number): void {
    this.zoomPan?.zoomBy(delta)
  }

  /**
   * Set pan position (if zoom/pan exists)
   */
  public setPan (x: number, y: number): void {
    this.zoomPan?.setPan(x, y)
  }

  /**
   * Pan by a relative amount (if zoom/pan exists)
   */
  public panBy (dx: number, dy: number): void {
    this.zoomPan?.panBy(dx, dy)
  }

  /**
   * Zoom to a specific point (if zoom/pan exists)
   */
  public zoomToPoint (scale: number, centerX: number = 0, centerY: number = 0): void {
    this.zoomPan?.zoomToPoint(scale, centerX, centerY)
  }

  /**
   * Reset view (if zoom/pan exists)
   */
  public resetView (): void {
    this.zoomPan?.reset()
  }

  /**
   * Get current zoom level (if zoom/pan exists)
   */
  public getZoomLevel (): number {
    return this.zoomPan?.getZoomLevel() ?? 1
  }

  /**
   * Get current pan position (if zoom/pan exists)
   */
  public getPanPosition (): { x: number; y: number } {
    return this.zoomPan?.getPanPosition() ?? { x: 0, y: 0 }
  }

  /**
   * Fit view to positions (if zoom/pan exists)
   */
  public fitToPositions (positions: [number, number][], scale?: number, padding = 0.1): void {
    this.zoomPan?.fitToPositions(positions, scale, padding)
  }

  /**
   * Set up resize observer for canvas
   */
  private setupResizeHandler (): void {
    const canvas = this.store.canvas
    const updateSize = (): void => {
      // Use canvas resolution, not CSS display size
      this.store.updateScreenSize(canvas.width, canvas.height)
    }

    // Initial size update
    updateSize()

    // Use ResizeObserver for canvas-specific changes
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === canvas) {
          updateSize()
        }
      }
    })

    this.resizeObserver.observe(canvas)
  }

  /**
   * Create and configure the zoom/pan
   */
  private createZoomPan (): void {
    // Pass main config directly to ZoomPan with onChange callback
    this.zoomPan = new ZoomPan(this.store, {
      ...this.config,
      onChange: (matrix: Float32Array): void => {
        this.pointRenderer?.setViewMatrix(matrix)
      },
    })
  }

  private renderLoop = (): void => {
    if (!this.isRunning) {
      return
    }

    // Call external tick callback if provided (runs physics simulation)
    if (this.config.onTick) {
      this.config.onTick()
    }

    // Render the points
    this.pointRenderer.render(this.device)

    // Submit GPU commands (necessary for WebGPU)
    this.device.submit()

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.renderLoop)
  }
}
