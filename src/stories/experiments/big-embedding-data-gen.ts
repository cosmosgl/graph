// Generate 3M points with predefined coordinates and nice coloring

function hslToRgb (hue: number, saturation: number, lightness: number): [number, number, number] {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - c / 2

  let r, g, b
  if (hue >= 0 && hue < 60) {
    r = c; g = x; b = 0
  } else if (hue >= 60 && hue < 120) {
    r = x; g = c; b = 0
  } else if (hue >= 120 && hue < 180) {
    r = 0; g = c; b = x
  } else if (hue >= 180 && hue < 240) {
    r = 0; g = x; b = c
  } else if (hue >= 240 && hue < 300) {
    r = x; g = 0; b = c
  } else {
    r = c; g = 0; b = x
  }

  return [r + m, g + m, b + m]
}

export function generateBigEmbeddingData (numPoints = 3000000): { pointPositions: Float32Array; pointColors: Float32Array } {
  const spaceSize = 4096
  const centerX = spaceSize / 2
  const centerY = spaceSize / 2

  const pointPositions = new Float32Array(numPoints * 2)
  const pointColors = new Float32Array(numPoints * 4)

  // Create a spiral pattern with gradient colors
  const maxRadius = spaceSize * 0.45
  const turns = 10

  for (let i = 0; i < numPoints; i++) {
    const t = i / numPoints
    const angle = t * turns * Math.PI * 2
    const radius = t * maxRadius

    // Add some noise for visual interest
    const noise = (Math.sin(i * 0.01) + Math.cos(i * 0.007)) * 50
    const x = centerX + Math.cos(angle) * (radius + noise)
    const y = centerY + Math.sin(angle) * (radius + noise)

    // Clamp to space bounds
    pointPositions[i * 2] = Math.max(0, Math.min(spaceSize, x))
    pointPositions[i * 2 + 1] = Math.max(0, Math.min(spaceSize, y))

    // Color based on position and index - create a beautiful gradient
    const hue = (t * 360 + angle * 180 / Math.PI) % 360
    const saturation = 0.7 + Math.sin(t * Math.PI) * 0.2
    const lightness = 0.5 + Math.cos(t * Math.PI * 2) * 0.2

    const [r, g, b] = hslToRgb(hue, saturation, lightness)

    pointColors[i * 4] = r
    pointColors[i * 4 + 1] = g
    pointColors[i * 4 + 2] = b
    pointColors[i * 4 + 3] = 1.0
  }

  return { pointPositions, pointColors }
}
