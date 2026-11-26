import { graphRgba } from '../../runtime/palette'
import type { LinkDistanceOpacity } from '../integrated-webgpu/renderer'
export type Scene = 'karate' | 'chain'
type Styles = { colors: Float32Array; sizes: Float32Array; link: [number, number, number, number]; width: number }
export const LINK_VISIBILITY: LinkDistanceOpacity = { range: [50, 150], minimum: 1 }
export const styles = (count: number, alternate: boolean): Styles => ({
  colors: new Float32Array(Array.from({ length: count }, (_, i) => alternate && i % 3 === 0
    ? [...graphRgba.coral.slice(0, 3), i === 0 ? 0 : 0.35]
    : graphRgba.point).flat()),
  sizes: Float32Array.from({ length: count }, (_, i) => alternate && i % 3 === 0 ? 10 : 6),
  link: alternate ? [graphRgba.coral[0], graphRgba.coral[1], graphRgba.coral[2], 0.7] : [graphRgba.link[0], graphRgba.link[1], graphRgba.link[2], 0.45],
  width: alternate ? 2.5 : 1.25,
})
