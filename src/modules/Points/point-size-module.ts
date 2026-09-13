import type { ShaderModule } from '@luma.gl/shadertools'
import pointSizeGlsl from '@/graph/modules/Points/point-size.glsl?raw'

/**
 * Shared GLSL for a point's on-screen size. Used by draw-points.vert, draw-highlighted.vert,
 * fill-picking-buffer.vert and find-points-in-rect.frag, so the drawn sprite, its ring, its
 * pickable footprint and its selection footprint agree.
 */
export const pointSizeModule: ShaderModule = {
  name: 'pointSize',
  vs: pointSizeGlsl,
  fs: pointSizeGlsl,
}
