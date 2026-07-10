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

// 3D overload: the same rational quadratic Bezier evaluated component-wise for
// world-space curves (3D links bend within the plane facing the camera).
vec3 conicParametricCurve(vec3 A, vec3 B, vec3 ControlPoint, float t, float w) {
  vec3 divident = (1.0 - t) * (1.0 - t) * A + 2.0 * (1.0 - t) * t * w * ControlPoint + t * t * B;
  float divisor = (1.0 - t) * (1.0 - t) + 2.0 * (1.0 - t) * t * w + t * t;
  return divident / divisor;
}
`

export const conicParametricCurveModule: ShaderModule = {
  name: 'conicParametricCurve',
  vs: conicParametricCurveVS,
}
