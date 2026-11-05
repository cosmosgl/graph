import type { ShaderModule } from '@luma.gl/shadertools'
import pointSizeGlsl from '@/graph/modules/Points/point-size.glsl?raw'

/**
 * Shared size scaling, zoom and hardware-cap calculation for draw-points.vert,
 * draw-highlighted.vert, fill-picking-buffer.vert and the area-selection shaders.
 * Callers apply pixel-size floors and shape or ring geometry separately.
 */
export const pointSizeModule: ShaderModule = {
  name: 'pointSize',
  vs: pointSizeGlsl,
  fs: pointSizeGlsl,
}
