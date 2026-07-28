import './style.css'

export class PolygonSelection {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private isDrawing = false
  private points: Array<{ x: number; y: number }> = []
  private graphDiv: HTMLElement
  private onPolygonComplete?: (points: [number, number][]) => void
  private boundStartDrawing: (e: MouseEvent) => void
  private boundDraw: (e: MouseEvent) => void
  private boundStopDrawing: () => void
  private resizeObserver: ResizeObserver

  public constructor (graphDiv: HTMLElement, onPolygonComplete?: (points: [number, number][]) => void) {
    this.graphDiv = graphDiv
    this.onPolygonComplete = onPolygonComplete

    // Bind event handlers
    this.boundStartDrawing = this.startDrawing.bind(this)
    this.boundDraw = this.draw.bind(this)
    this.boundStopDrawing = this.stopDrawing.bind(this)

    // Create canvas
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'polygon-canvas'

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get canvas context')
    this.ctx = ctx

    this.graphDiv.appendChild(this.canvas)

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas()
    })
    this.resizeObserver.observe(this.graphDiv)
  }

  public enablePolygonMode (): void {
    this.canvas.style.pointerEvents = 'auto'
    this.canvas.style.cursor = 'crosshair'

    // Add event listeners
    this.canvas.addEventListener('mousedown', this.boundStartDrawing)
    this.canvas.addEventListener('mousemove', this.boundDraw)
    this.canvas.addEventListener('mouseup', this.boundStopDrawing)
  }

  public disablePolygonMode (): void {
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.cursor = 'default'

    // Remove event listeners
    this.canvas.removeEventListener('mousedown', this.boundStartDrawing)
    this.canvas.removeEventListener('mousemove', this.boundDraw)
    this.canvas.removeEventListener('mouseup', this.boundStopDrawing)

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  public destroy (): void {
    this.disablePolygonMode()
    this.resizeObserver.disconnect()
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
  }

  private resizeCanvas (): void {
    const rect = this.graphDiv.getBoundingClientRect()

    // Apply pixel ratio for crisp rendering
    const pixelRatio = window.devicePixelRatio || 1
    this.canvas.width = rect.width * pixelRatio
    this.canvas.height = rect.height * pixelRatio

    // Reset transform and scale the context to match the pixel ratio
    this.ctx.resetTransform()
    this.ctx.scale(pixelRatio, pixelRatio)
  }

  private startDrawing (e: MouseEvent): void {
    this.isDrawing = true
    this.points = []
    const rect = this.canvas.getBoundingClientRect()
    this.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private draw (e: MouseEvent): void {
    if (!this.isDrawing) return

    const rect = this.canvas.getBoundingClientRect()
    this.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top })

    // Clear the entire canvas accounting for pixel ratio
    const pixelRatio = window.devicePixelRatio || 1
    this.ctx.clearRect(0, 0, this.canvas.width / pixelRatio, this.canvas.height / pixelRatio)

    this.ctx.beginPath()
    if (this.points.length > 0 && this.points[0]) {
      this.ctx.moveTo(this.points[0].x, this.points[0].y)
    }

    for (let i = 1; i < this.points.length; i++) {
      const point = this.points[i]
      if (point) {
        this.ctx.lineTo(point.x, point.y)
      }
    }

    this.ctx.strokeStyle = '#ffffff'
    this.ctx.lineWidth = 2
    this.ctx.stroke()
  }

  private stopDrawing (): void {
    if (!this.isDrawing) return
    this.isDrawing = false

    if (this.points.length > 2) {
      this.ctx.closePath()
      this.ctx.stroke()

      const polygonPoints: [number, number][] = this.points.map(p => [p.x, p.y])
      const firstPolygonPoint = polygonPoints[0]
      const lastPolygonPoint = polygonPoints[polygonPoints.length - 1]
      if (firstPolygonPoint && lastPolygonPoint && (firstPolygonPoint[0] !== lastPolygonPoint[0] || firstPolygonPoint[1] !== lastPolygonPoint[1])) {
        polygonPoints.push(firstPolygonPoint)
      }

      if (this.onPolygonComplete) {
        this.onPolygonComplete(polygonPoints)
      }
    }

    const pixelRatio = window.devicePixelRatio || 1
    this.ctx.clearRect(0, 0, this.canvas.width / pixelRatio, this.canvas.height / pixelRatio)
    this.disablePolygonMode()
  }
}
