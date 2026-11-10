// Correctly rounded binary32 / positive integer count, round-to-nearest-even.
// Contract: finite binary32 input and count in 1..16384 (the lab's point cap).
// Integer operations preserve the rounding decision through shader optimization.
fn divideByCount(value: f32, count: u32) -> f32 {
  let bits = bitcast<u32>(value);
  let sign = bits & 0x80000000u;
  let exponent = (bits >> 23u) & 255u;
  let fraction = bits & 0x7fffffu;
  if (count == 0u) { return 0.; } // Empty cells are excluded by the caller.
  if (exponent == 255u || (exponent == 0u && fraction == 0u)) { return value; }
  var mantissa = fraction;
  var shift = 0u;
  var resultExponent = 0u;
  if (exponent != 0u) {
    mantissa |= 0x800000u;
    let power = 31u - countLeadingZeros(count);
    shift = power;
    if (mantissa < (count << (23u - power))) { shift++; }
    if (exponent > shift) {
      resultExponent = exponent - shift;
    } else {
      // Round directly in subnormal units; avoid a double-rounding boundary.
      shift = exponent - 1u;
    }
  }
  var quotient = mantissa / count;
  var remainder = mantissa % count;
  // Append at most 14 binary digits without forming a 38-bit numerator.
  for (var i = 0u; i < shift; i++) {
    quotient <<= 1u;
    remainder <<= 1u;
    if (remainder >= count) { remainder -= count; quotient |= 1u; }
  }
  let twiceRemainder = remainder << 1u;
  if (twiceRemainder > count || (twiceRemainder == count && (quotient & 1u) != 0u)) { quotient++; }
  if (resultExponent == 0u) { return bitcast<f32>(sign | quotient); }
  if (quotient == 0x1000000u) { quotient >>= 1u; resultExponent++; }
  return bitcast<f32>(sign | (resultExponent << 23u) | (quotient & 0x7fffffu));
}
