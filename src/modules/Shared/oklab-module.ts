import type { ShaderModule } from '@luma.gl/shadertools'

/**
 * Shared GLSL for the OKLab perceptual color space (Björn Ottosson, 2020,
 * https://bottosson.github.io/posts/oklab/). Attach via a Model's `modules` to make the
 * functions available in that shader; the code is valid in both vertex and fragment stages.
 *
 * All sRGB values are the encoded 0..1 numbers the engine stores (what `getRgbaColor`
 * returns); the module linearises them itself. OKLab `L` is lightness in 0..1, `a`/`b` the
 * opponent axes; chroma is `length(lab.yz)`, hue `atan(lab.z, lab.y)`.
 *
 * Matrices are written column-major as GLSL expects — the reference lists them row-major.
 */
const oklabGLSL = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(0.04045, c));
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(0.0031308, c));
}

vec3 linearToOklab(vec3 c) {
  const mat3 rgbToLms = mat3(
    0.4122214708, 0.2119034982, 0.0883024619,
    0.5363325363, 0.6806995451, 0.2817188376,
    0.0514459929, 0.1073969566, 0.6299787005
  );
  const mat3 lmsToLab = mat3(
     0.2104542553,  1.9779984951,  0.0259040371,
     0.7936177850, -2.4285922050,  0.7827717662,
    -0.0040720468,  0.4505937099, -0.8086757660
  );
  vec3 lms = rgbToLms * c;
  lms = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0)); // cube root, safe for tiny negatives
  return lmsToLab * lms;
}

vec3 oklabToLinear(vec3 lab) {
  const mat3 labToLms = mat3(
    1.0,           1.0,           1.0,
    0.3963377774, -0.1055613458, -0.0894841775,
    0.2158037573, -0.0638541728, -1.2914855480
  );
  const mat3 lmsToRgb = mat3(
     4.0767416621, -1.2684380046, -0.0041960863,
    -3.3077115913,  2.6097574011, -0.7034186147,
     0.2309699292, -0.3413193965,  1.7076147010
  );
  vec3 lms = labToLms * lab;
  return lmsToRgb * (lms * lms * lms);
}

vec3 srgbToOklab(vec3 srgb) { return linearToOklab(srgbToLinear(srgb)); }
vec3 oklabToSrgb(vec3 lab) { return linearToSrgb(oklabToLinear(lab)); }

bool isInSrgbGamut(vec3 linear) {
  const float eps = 1e-4;
  return all(greaterThanEqual(linear, vec3(-eps))) && all(lessThanEqual(linear, vec3(1.0 + eps)));
}

// Gamut mapping that keeps lightness and hue: scale chroma down until the color fits in
// sRGB. The grey axis (chroma 0) is always in gamut for L in 0..1, so the bisection always
// converges; 8 steps give a chroma scale accurate to 1/256.
vec3 oklabClampChroma(vec3 lab) {
  lab.x = clamp(lab.x, 0.0, 1.0);
  if (isInSrgbGamut(oklabToLinear(lab))) return lab;
  float lo = 0.0;
  float hi = 1.0;
  for (int i = 0; i < 8; i++) {
    float mid = 0.5 * (lo + hi);
    if (isInSrgbGamut(oklabToLinear(vec3(lab.x, lab.yz * mid)))) lo = mid; else hi = mid;
  }
  return vec3(lab.x, lab.yz * lo);
}
`

export const oklabModule: ShaderModule = {
  name: 'oklab',
  vs: oklabGLSL,
  fs: oklabGLSL,
}
