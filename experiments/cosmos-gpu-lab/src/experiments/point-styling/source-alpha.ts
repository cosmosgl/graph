// Explicit nearest UNORM8, ties upward, for an f32 source alpha. The CPU uses
// double arithmetic; a 24-bit f32 significand times 255 is exact at this precision.
export function sourceAlphaByte (alpha: number): number {
  return Math.floor(0.5 + 255 * Math.min(1, Math.max(0, Math.fround(alpha))))
}

export const SOURCE_ALPHA_POLICY = {
  name: 'unorm8-nearest-ties-up',
  version: 1,
  format: 'rgba8unorm',
  alpha: 'coverage * (subpixelArea * fillAlpha) * globalOpacity; f32',
  quantizer: 'floor(0.5 + 255 * clamp(alpha, 0, 1))',
  picking: 'original half-coverage geometry and source byte > 0',
} as const

export const SOURCE_BYTE_PICKING_POLICY = {
  ...SOURCE_ALPHA_POLICY,
  name: 'source-byte-picking-original-color',
  color: 'original unquantized source alpha and source-over blending',
} as const

// Match WGSL's specified packing rule without an f32 "+ 0.5" rounding a value
// just below the first threshold up to 1. Integer significand * 255 fits u32.
// Read quotient and rounding bit separately to avoid addition overflow.
export const SOURCE_ALPHA_GLSL = `
float quantizeSourceAlpha(float alpha) {
  if (alpha <= 0.0) return 0.0;
  if (alpha >= 1.0) return 1.0;
  highp uint bits = floatBitsToUint(alpha);
  highp uint exponent = (bits >> 23u) & 255u;
  if (exponent < 118u) return 0.0;
  highp uint product = ((bits & 0x007fffffu) | 0x00800000u) * 255u;
  if (exponent == 118u) return float(product >> 31u) / 255.0;
  highp uint shift = 150u - exponent;
  return float((product >> shift) + ((product >> (shift - 1u)) & 1u)) / 255.0;
}`

export const SOURCE_ALPHA_WGSL = `
fn quantizeSourceAlpha(alpha: f32) -> f32 {
  if (alpha <= 0.0) { return 0.0; }
  if (alpha >= 1.0) { return 1.0; }
  let bits = bitcast<u32>(alpha);
  let exponent = (bits >> 23u) & 255u;
  if (exponent < 118u) { return 0.0; }
  let product = ((bits & 0x007fffffu) | 0x00800000u) * 255u;
  if (exponent == 118u) { return f32(product >> 31u) / 255.0; }
  let shift = 150u - exponent;
  return f32((product >> shift) + ((product >> (shift - 1u)) & 1u)) / 255.0;
}`
