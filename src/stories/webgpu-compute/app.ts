import { Buffer, Device } from '@luma.gl/core'
import { PointRenderer } from './point-renderer'

const GRAVITY_STRENGTH = 0.2 // Base gravitational force strength

export type OnTickCallback = () => void;

export interface BouncingDisksAppConfig {
  device: Device;
  positionBuffer: Buffer;
  instanceCount: number;
  onTick?: OnTickCallback;
}

export class BouncingDisksApp {
  private device: Device
  private pointRenderer!: PointRenderer
  private positionBuffer: Buffer
  private instanceCount: number
  private onTick?: OnTickCallback

  // Animation loop state
  private animationFrameId: number | null = null
  private isRunning: boolean = false

  constructor (config: BouncingDisksAppConfig) {
    this.device = config.device
    this.positionBuffer = config.positionBuffer
    this.instanceCount = config.instanceCount
    this.onTick = config.onTick
  }

  async initialize (): Promise<void> {
    // Initialize renderer with provided position buffer
    this.pointRenderer = new PointRenderer({
      device: this.device,
      instanceCount: this.instanceCount,
      positionBuffer: this.positionBuffer,
    })
  }

  setOnTickCallback (onTick: OnTickCallback): void {
    this.onTick = onTick
  }

  start (): void {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.renderLoop()
  }

  stop (): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  destroy (): void {
    this.stop()
    this.pointRenderer?.destroy()
  }

  private renderLoop = (): void => {
    if (!this.isRunning) {
      return
    }

    // Call external tick callback if provided (runs physics simulation)
    if (this.onTick) {
      this.onTick()
    }

    // Render the points
    this.pointRenderer.render(this.device)

    // Submit GPU commands (necessary for WebGPU)
    this.device.submit()

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.renderLoop)
  }
}
