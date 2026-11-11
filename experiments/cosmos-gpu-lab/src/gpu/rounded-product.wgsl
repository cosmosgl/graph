// Float32 product rounded to nearest, ties to even, using a 48-bit significand product.
// Finite-normal inputs AND result only; native fallback outside that contract.
// Generalizes the lab's roundedSquare; all intermediates here are integer operations.
fn roundedProduct(a: f32, b: f32) -> f32 {
  let aBits = bitcast<u32>(a); let bBits = bitcast<u32>(b);
  let sign = (aBits ^ bBits) & 0x80000000u;
  let ea = i32((aBits >> 23u) & 255u); let eb = i32((bBits >> 23u) & 255u);
  if (ea == 0 || eb == 0 || ea == 255 || eb == 255) { return a * b; }
  let ma = (aBits & 0x7fffffu) | 0x800000u; let mb = (bBits & 0x7fffffu) | 0x800000u;
  let a0 = ma & 4095u; let a1 = ma >> 12u; let b0 = mb & 4095u; let b1 = mb >> 12u;
  let p0 = a0 * b0; let p1 = a0 * b1 + a1 * b0; let p2 = a1 * b1;
  let low0 = p0 + (p1 << 12u);
  let high0 = (p1 >> 20u) + select(0u, 1u, low0 < p0);
  let low = low0 + (p2 << 24u);
  let high = high0 + (p2 >> 8u) + select(0u, 1u, low < low0);
  let shift = select(23u, 24u, (high & 0x8000u) != 0u);
  var exponent = ea + eb - 150 + i32(shift);
  if (exponent <= 0 || exponent >= 255) { return a * b; }
  var q = (low >> shift) | (high << (32u - shift));
  let remainder = low & ((1u << shift) - 1u); let half = 1u << (shift - 1u);
  if (remainder > half || (remainder == half && (q & 1u) != 0u)) { q++; }
  if (q == 0x1000000u) { q >>= 1u; exponent++; }
  if (exponent >= 255) { return a * b; }
  return bitcast<f32>(sign | (u32(exponent) << 23u) | (q & 0x7fffffu));
}
