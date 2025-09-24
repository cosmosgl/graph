import { generateInstanceColors, generateInstanceRadii, rgbToHslString } from './color-utils'

export interface NativePointRendererConfig {
  canvas: HTMLCanvasElement;
  instanceCount: number;
}

export class NativePointRenderer {
  private canvas: HTMLCanvasElement
  private context: CanvasRenderingContext2D
  private instanceColors: string[] = []
  private instanceRadii: number[] = []
  private devicePixelRatio: number

  public constructor (config: NativePointRendererConfig) {
    const { canvas, instanceCount } = config

    this.canvas = canvas
    this.devicePixelRatio = window.devicePixelRatio || 1

    // Get 2D context
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Failed to get 2D canvas context')
    }
    this.context = context

    // Scale the context to account for device pixel ratio
    this.context.scale(this.devicePixelRatio, this.devicePixelRatio)

    // Generate colors and radii for each instance
    this.initializeInstanceData(instanceCount)
  }

  public render (positions: Float32Array, clearColor: [number, number, number, number] = [248, 249, 250, 255]): void {
    // Get display dimensions (CSS pixels)
    const displayWidth = this.canvas.clientWidth
    const displayHeight = this.canvas.clientHeight

    // Clear the canvas
    this.context.clearRect(0, 0, displayWidth, displayHeight)

    // Draw background
    const [r, g, b, a] = clearColor
    this.context.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`
    this.context.fillRect(0, 0, displayWidth, displayHeight)

    // Convert normalized coordinates to display coordinates and draw points
    for (let i = 0; i < positions.length; i += 2) {
      const x = ((positions[i] ?? 0) + 1) * displayWidth / 2 // Convert from [-1,1] to [0,displayWidth]
      const y = (1 - (positions[i + 1] ?? 0)) * displayHeight / 2 // Convert from [-1,1] to [0,displayHeight], flip Y

      // Draw point as a circle
      this.context.beginPath()
      const color = this.instanceColors[i / 2]
      const radius = this.instanceRadii[i / 2]
      if (color && radius !== undefined) {
        this.context.fillStyle = color
        // Scale radius by device pixel ratio to match WebGPU renderer
        this.context.arc(x, y, radius / this.devicePixelRatio, 0, 2 * Math.PI)
        this.context.fill()
      }
    }
  }

  public destroy (): void {
    // No cleanup needed for 2D canvas context
  }

  private initializeInstanceData (instanceCount: number): void {
    this.instanceColors = []
    this.instanceRadii = []

    // Generate distributed colors and radii using shared utilities
    const colors = generateInstanceColors(instanceCount)
    const radii = generateInstanceRadii(instanceCount)

    for (let i = 0; i < instanceCount; i++) {
      // Convert RGB to HSL string for canvas
      const color = colors[i]
      if (color) {
        this.instanceColors.push(rgbToHslString(color))
      }

      // Store radius in pixels
      const radius = radii[i]
      if (radius !== undefined) {
        this.instanceRadii.push(radius)
      }
    }
  }
}
