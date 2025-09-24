/**
 * Shared color and size generation utilities for consistent rendering across renderers
 */

export interface Color {
  r: number
  g: number
  b: number
}

/**
 * Generate a color using HSL with good distribution
 * @param index - The index of the color (0-based)
 * @param total - Total number of colors to generate
 * @returns RGB color values (0-1 range)
 */
export function generateDistributedColor(index: number, total: number): Color {
  const hue = (index * 360) / total
  const saturation = 70
  const lightness = 60
  
  // Convert HSL to RGB
  const h = hue / 360
  const s = saturation / 100
  const l = lightness / 100
  
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h * 6) % 2 - 1))
  const m = l - c / 2
  
  let r = 0, g = 0, b = 0
  
  if (h < 1/6) {
    r = c; g = x; b = 0
  } else if (h < 2/6) {
    r = x; g = c; b = 0
  } else if (h < 3/6) {
    r = 0; g = c; b = x
  } else if (h < 4/6) {
    r = 0; g = x; b = c
  } else if (h < 5/6) {
    r = x; g = 0; b = c
  } else {
    r = c; g = 0; b = x
  }
  
  return {
    r: r + m,
    g: g + m,
    b: b + m
  }
}

/**
 * Generate colors for all instances using the same distribution
 * @param instanceCount - Number of instances
 * @returns Array of RGB colors (0-1 range)
 */
export function generateInstanceColors(instanceCount: number): Color[] {
  const colors: Color[] = []
  
  for (let i = 0; i < instanceCount; i++) {
    colors.push(generateDistributedColor(i, instanceCount))
  }
  
  return colors
}

/**
 * Convert RGB color to CSS HSL string
 * @param color - RGB color (0-1 range)
 * @returns CSS HSL string
 */
export function rgbToHslString(color: Color): string {
  const r = color.r
  const g = color.g
  const b = color.b
  
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const diff = max - min
  
  let h = 0
  let s = 0
  const l = (max + min) / 2
  
  if (diff !== 0) {
    s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min)
    
    switch (max) {
      case r:
        h = ((g - b) / diff + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / diff + 2) / 6
        break
      case b:
        h = ((r - g) / diff + 4) / 6
        break
    }
  }
  
  return `hsl(${Math.round(h * 360)}, 70%, 60%)`
}

// Point size constants
const MIN_RADIUS = 4 // Minimum disk radius in pixels
const MAX_RADIUS = 15 // Maximum disk radius in pixels

/**
 * Generate a random radius within the defined range
 * @param index - The index of the point (for potential deterministic generation)
 * @returns Radius in pixels
 */
export function generatePointRadius(index: number): number {
  // Use a simple pseudo-random generator based on index for consistency
  // This ensures the same point always gets the same size across renderers
  const seed = (index * 9301 + 49297) % 233280
  const normalized = seed / 233280
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * normalized
}

/**
 * Generate radii for all instances using the same distribution
 * @param instanceCount - Number of instances
 * @returns Array of radii in pixels
 */
export function generateInstanceRadii(instanceCount: number): number[] {
  const radii: number[] = []
  
  for (let i = 0; i < instanceCount; i++) {
    radii.push(generatePointRadius(i))
  }
  
  return radii
}

/**
 * Convert pixel radius to normalized radius for canvas scaling
 * @param pixelRadius - Radius in pixels
 * @param canvasWidth - Canvas width in pixels
 * @returns Normalized radius (0-1 range)
 */
export function pixelRadiusToNormalized(pixelRadius: number, canvasWidth: number): number {
  return pixelRadius / (canvasWidth / 2)
}
