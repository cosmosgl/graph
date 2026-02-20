import type { ShaderModule } from '@luma.gl/shadertools'

/**
 * Shared GLSL for conic parametric curve (rational quadratic Bezier).
 * Used by draw-curve-line.vert and fill-sampled-links.vert.
 */
const conicParametricCurveVS = /* glsl */ `
vec2 conicParametricCurve(vec2 A, vec2 B, vec2 ControlPoint, float t, float w) {
  vec2 divident = (1.0 - t) * (1.0 - t) * A + 2.0 * (1.0 - t) * t * w * ControlPoint + t * t * B;
  float divisor = (1.0 - t) * (1.0 - t) + 2.0 * (1.0 - t) * t * w + t * t;
  return divident / divisor;
}
`

export const conicParametricCurveModule: ShaderModule = {
  name: 'conicParametricCurve',
  vs: conicParametricCurveVS,
}
