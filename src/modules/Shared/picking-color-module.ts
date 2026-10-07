import type { ShaderModule } from '@luma.gl/shadertools'

/**
 * Shared GLSL for the host-picking color (renderMode 3) a point or link fragment writes.
 * Used by draw-points.frag and draw-curve-line.frag, so both element kinds encode their
 * index for a host's pick pass by one rule.
 *
 * `index + 1` is packed little-endian into the three color bytes, as deck.gl and most hosts
 * decode it (`r + g * 256 + b * 65536 - 1`); 0 — a black pixel — is left for "nothing here".
 */
const pickingColorFS = /* glsl */ `
vec3 encodePickingColor(float index) {
  float i = index + 1.0;
  return vec3(mod(i, 256.0), mod(floor(i / 256.0), 256.0), floor(i / 65536.0)) / 255.0;
}
`

export const pickingColorModule: ShaderModule = {
  name: 'pickingColor',
  fs: pickingColorFS,
}
