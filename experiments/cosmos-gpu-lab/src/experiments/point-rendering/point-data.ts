import type { PointRenderData } from './backend'

export const POINT_COUNTS = [1, 64, 1024, 10000] as const
export const MAX_POINT_COUNT = POINT_COUNTS[POINT_COUNTS.length - 1]

export function createPointData (count: number, phase: number): PointRenderData {
  const positions = new Float32Array(count * 2)
  const colors = new Float32Array(count * 4)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  for (let index = 0; index < count; index++) {
    const ratio = count === 1 ? 0 : Math.sqrt((index + 0.5) / count)
    const angle = index * goldenAngle + phase * 0.37
    positions[index * 2] = Math.cos(angle) * ratio * 0.58
    positions[index * 2 + 1] = Math.sin(angle) * ratio * 0.86

    colors[index * 4] = 0.58 + 0.27 * Math.cos(angle)
    colors[index * 4 + 1] = 0.68 + 0.2 * Math.cos(angle + 2.1)
    colors[index * 4 + 2] = 0.8 + 0.16 * Math.cos(angle + 4.2)
    colors[index * 4 + 3] = 0.88
  }

  return { positions, colors, count }
}
