import { comparePixels, type PixelComparison } from '../../runtime/compare-pixels'
import { pointCases, pointCell, pointShapes, pointsViewport } from './fixture'

export function comparePoints (gl: ImageData, gpu: ImageData, ratio: 1 | 2, mask?: ImageData): PixelComparison & { byShape: number[][] } {
  if (gl.width !== pointsViewport.width * ratio || gl.height !== pointsViewport.height * ratio) {
    throw new Error(`The reference canvas does not match pixel ratio ${ratio}`)
  }
  const byShape = pointShapes.map(() => pointCases.map(() => 0))
  const cellWidth = pointCell.width * ratio
  const cellHeight = pointCell.height * ratio
  const result = comparePixels(gl, gpu, mask, index => {
    const column = Math.floor((index % gl.width) / cellWidth)
    const row = Math.floor(index / (gl.width * cellHeight))
    byShape[column][row]++
  })
  return { ...result, byShape }
}
