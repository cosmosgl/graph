import { scaleSequential } from 'd3-scale'
import { interpolateWarm } from 'd3-scale-chromatic'
import { getRgbaColor } from '@cosmos.gl/graph'

export const getPointColors = (pointPositions: number[]): Float32Array => {
  const pointColorScale = scaleSequential(interpolateWarm)
  const numPoints = pointPositions.length / 2

  // Calculate center coordinates
  let centerX = 0
  let centerY = 0
  for (let i = 0, idx = 0; i < numPoints; i++, idx += 2) {
    centerX += pointPositions[idx] as number
    centerY += pointPositions[idx + 1] as number
  }
  centerX /= numPoints
  centerY /= numPoints

  // Find maximum distance from center (using squared distance for optimization)
  let maxDistanceSquared = 0
  for (let i = 0, idx = 0; i < numPoints; i++, idx += 2) {
    const dx = (pointPositions[idx] as number) - centerX
    const dy = (pointPositions[idx + 1] as number) - centerY
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared > maxDistanceSquared) maxDistanceSquared = distanceSquared
  }

  pointColorScale.domain([0, Math.sqrt(maxDistanceSquared)])

  // Calculate colors
  const pointColors = new Float32Array(numPoints * 4)
  for (let i = 0, posIdx = 0, colorIdx = 0; i < numPoints; i++, posIdx += 2, colorIdx += 4) {
    const dx = (pointPositions[posIdx] as number) - centerX
    const dy = (pointPositions[posIdx + 1] as number) - centerY
    const distance = Math.sqrt(dx * dx + dy * dy)
    const pointColor = pointColorScale(distance)
    const rgba = getRgbaColor(pointColor)

    pointColors[colorIdx] = rgba[0]
    pointColors[colorIdx + 1] = rgba[1]
    pointColors[colorIdx + 2] = rgba[2]
    pointColors[colorIdx + 3] = rgba[3]
  }

  return pointColors
}
