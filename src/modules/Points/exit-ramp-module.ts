import type { ShaderModule } from '@luma.gl/shadertools'
import exitRampGlsl from '@/graph/modules/Points/exit-ramp.glsl?raw'

/**
 * Shared GLSL for a point's enter/exit ramp and the size it resolves to along it. Used by
 * draw-points.vert and draw-highlighted.vert, so the sprite and its hover/focus ring fade and
 * mix sizes by one rule.
 */
export const exitRampModule: ShaderModule = {
  name: 'exitRamp',
  vs: exitRampGlsl,
}
