export type PointTransitionData = { positions: Float32Array; sizes: Float32Array; colors: Float32Array }
export type PointTransitionFrame = { progress: number; positions: boolean; sizes: boolean; colors: boolean }
export type PointTransitionOutput = { positions: Float32Array; styles: Float32Array }
export type PointTransitionRunner = {
  start(target: PointTransitionData): void;
  draw(frame: PointTransitionFrame): Promise<PointTransitionOutput>;
  destroy(): void;
}
export const POINT_TRANSITION_DEFAULT_SIZE = 12
export const POINT_TRANSITION_DEFAULT_COLOR = [0.25, 0.5, 0.75, 0.875] as const

export function transitionFlags (frame: PointTransitionFrame): [number, number, number, number] {
  return [frame.progress, Number(frame.positions), Number(frame.colors), Number(frame.sizes)]
}

// R/G absence takes the last and next user data, independently of the
// interpolated position buffer that may retain an exiting point's coordinates.
export function transitionAttributes (previous: PointTransitionData, next: PointTransitionData): Float32Array {
  const properties = new Float32Array(previous.positions.length)
  for (let index = 0; index < next.sizes.length; index++) {
    const offset = index * 4
    properties.set([previous.sizes[index], next.sizes[index], Number.isNaN(previous.positions[offset]) ? 1 : 0,
      Number.isNaN(next.positions[offset]) ? 1 : 0], offset)
  }
  return properties
}

export function pointTransitionReference (
  sourcePosition: Float32Array, current: Float32Array, oldTarget: PointTransitionData, next: PointTransitionData, frame: PointTransitionFrame
): PointTransitionOutput {
  const positions = current.slice()
  const styles = new Float32Array(current.length * 2)
  const mix = (a: number, b: number): number => a + (b - a) * frame.progress
  for (let index = 0; index < next.sizes.length; index++) {
    const offset = index * 4
    const wasAbsent = Number.isNaN(oldTarget.positions[offset]) ? 1 : 0
    const absent = Number.isNaN(next.positions[offset]) ? 1 : 0
    if (frame.positions) {
      const from = Number.isNaN(sourcePosition[offset]) ? next.positions : sourcePosition
      const to = absent ? from : next.positions
      positions.set([mix(from[offset], to[offset]), mix(from[offset + 1], to[offset + 1]), sourcePosition[offset + 2], 1], offset)
    }
    const exit = frame.positions ? mix(wasAbsent, absent) : absent
    const resolve = (value: number, fallback: number): number => Number.isNaN(value) ? fallback * (1 - exit) : value
    const targetSize = resolve(next.sizes[index], POINT_TRANSITION_DEFAULT_SIZE)
    const size = frame.sizes ? mix(resolve(oldTarget.sizes[index], POINT_TRANSITION_DEFAULT_SIZE), targetSize) : targetSize
    // The shader culls a gone point before resolving its size or colors.
    styles.set([exit < 1 ? size : 0, exit, absent, exit < 1 && size > 0 ? 1 : 0], index * 8)
    if (exit >= 1) continue
    for (let channel = 0; channel < 4; channel++) {
      const fallback = POINT_TRANSITION_DEFAULT_COLOR[channel]
      const targetColor = resolve(next.colors[offset + channel], fallback)
      styles[index * 8 + 4 + channel] = frame.colors ? mix(resolve(oldTarget.colors[offset + channel], fallback), targetColor) : targetColor
    }
  }
  return { positions, styles }
}
