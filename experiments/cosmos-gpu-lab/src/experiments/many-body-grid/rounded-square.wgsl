// Exact significand product, rounded once before the distance addition.
// Native fallback outside the finite-normal squared-result range.
fn roundedSquare(value: f32) -> f32 {
  let bits = bitcast<u32>(value) & 0x7fffffffu;
  if (bits == 0u) { return 0.; }
  let exponent = i32(bits >> 23u);
  if (exponent == 0 || exponent == 255) { return value * value; }
  let m = (bits & 0x7fffffu) | 0x800000u;
  let a = m & 4095u; let b = m >> 12u;
  let aa = a * a; let ab = 2u * a * b; let bb = b * b;
  let low0 = aa + (ab << 12u);
  let high0 = (ab >> 20u) + select(0u, 1u, low0 < aa);
  let low = low0 + (bb << 24u);
  let high = high0 + (bb >> 8u) + select(0u, 1u, low < low0);
  let shift = select(23u, 24u, (high & 0x8000u) != 0u);
  var e = 2 * exponent - 150 + i32(shift);
  if (e <= 0 || e >= 255) { return value * value; }
  var q = (low >> shift) | (high << (32u - shift));
  let remainder = low & ((1u << shift) - 1u); let half = 1u << (shift - 1u);
  if (remainder > half || (remainder == half && (q & 1u) != 0u)) { q++; }
  if (q == 0x1000000u) { q >>= 1u; e++; }
  return bitcast<f32>((u32(e) << 23u) | (q & 0x7fffffu));
}
