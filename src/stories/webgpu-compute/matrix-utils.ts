// Matrix utilities for zoom and pan transformations
// Simplified approach inspired by Cosmos, adapted for WebGPU

/**
 * ViewTransform - tracks zoom and pan state
 * Inspired by Cosmos but simplified for WebGPU
 */
export class ViewTransform {
  // Transform state (similar to d3-zoom's transform)
  public x: number = 0 // Pan X in normalized coords
  public y: number = 0 // Pan Y in normalized coords
  public k: number = 1 // Zoom level (scale)

  /**
   * Build the view matrix from current transform state
   * Transformation order (like Cosmos):
   * 1. Translate by pan (x, y)
   * 2. Scale by zoom level (k)
   */
  public getMatrix (): Float32Array {
    const { x, y, k } = this

    // Combined transformation matrix
    // Order matters: translate THEN scale creates zoom-to-center effect
    return new Float32Array([
      k, 0, 0, 0,
      0, k, 0, 0,
      0, 0, 1, 0,
      x, y, 0, 1,
    ])
  }

  /**
   * Set zoom level (absolute)
   */
  public setZoom (scale: number): void {
    this.k = scale
  }

  /**
   * Zoom by a delta factor (relative)
   * @param delta - Multiplier (e.g., 1.1 = zoom in 10%, 0.9 = zoom out 10%)
   */
  public zoomBy (delta: number): void {
    this.k *= delta
  }

  /**
   * Set pan position (absolute)
   */
  public setPan (panX: number, panY: number): void {
    this.x = panX
    this.y = panY
  }

  /**
   * Pan by a delta (relative)
   */
  public panBy (dx: number, dy: number): void {
    this.x += dx
    this.y += dy
  }

  /**
   * Zoom to a specific point
   * @param scale - Target zoom level
   * @param centerX - Point to zoom towards (normalized coords)
   * @param centerY - Point to zoom towards (normalized coords)
   */
  public zoomToPoint (scale: number, centerX: number = 0, centerY: number = 0): void {
    // Calculate new pan to keep the center point stable
    const scaleDelta = scale / this.k
    this.x = centerX - (centerX - this.x) * scaleDelta
    this.y = centerY - (centerY - this.y) * scaleDelta
    this.k = scale
  }

  /**
   * Reset to identity (no zoom, no pan)
   */
  public reset (): void {
    this.x = 0
    this.y = 0
    this.k = 1
  }
}
