// Exact round-to-nearest-even for normal binary32 inputs/results (plus zero).
// Subnormal inputs/results and non-finite values retain native behavior.
// A native estimate only seeds the search; integer midpoint comparisons decide
// the answer. No fused fma, float residual or compiler rounding barrier is needed.

// Unsigned product of two at-most-26-bit integers, returned as (low, high).
fn arithmeticProduct(a: u32, b: u32) -> vec2<u32> {
  let lowProduct = (a & 65535u) * (b & 65535u);
  let cross = (a >> 16u) * (b & 65535u) + (b >> 16u) * (a & 65535u);
  let low = lowProduct + (cross << 16u);
  return vec2(low, (a >> 16u) * (b >> 16u) + (cross >> 16u) + select(0u, 1u, low < lowProduct));
}
fn arithmeticShift(a: u32, shift: u32) -> vec2<u32> {
  return vec2(a << shift, a >> (32u - shift));
}
fn arithmeticCompare(a: vec2<u32>, b: vec2<u32>) -> i32 {
  if (a.y != b.y) { return select(-1, 1, a.y > b.y); }
  return select(select(-1, 1, a.x > b.x), 0, a.x == b.x);
}
// For division compare 2*numerator with (2*m +/- 1)*denominator.
// For root compare 4*radicand with (2*m +/- 1)^2. Both are exact
// comparisons to the midpoints around the integer significand m.
fn arithmeticDirection(m: u32, midpointValue: vec2<u32>, divisor: u32) -> i32 {
  let lower = 2u * m - 1u;
  let upper = lower + 2u;
  let lo = arithmeticCompare(midpointValue, arithmeticProduct(lower, select(divisor, lower, divisor == 0u)));
  let hi = arithmeticCompare(midpointValue, arithmeticProduct(upper, select(divisor, upper, divisor == 0u)));
  let odd = (m & 1u) != 0u;
  if (lo < 0 || (lo == 0 && odd)) { return -1; }
  if (hi > 0 || (hi == 0 && odd)) { return 1; }
  return 0;
}
fn arithmeticRound(estimate: u32, midpointValue: vec2<u32>, divisor: u32) -> u32 {
  var m = clamp(estimate, 0x800000u, 0x1000000u);
  for (var i = 0u; i < 8u; i++) {
    let direction = arithmeticDirection(m, midpointValue, divisor);
    if (direction == 0) { return m; }
    m = u32(i32(m) + direction);
  }
  // Bound the work even if a future implementation supplies a poor estimate.
  // The normalized exact result lies in [2^23, 2^24].
  var low = 0x800000u;
  var high = 0x1000000u;
  for (var i = 0u; i < 25u; i++) {
    m = low + (high - low) / 2u;
    let direction = arithmeticDirection(m, midpointValue, divisor);
    if (direction == 0) { return m; }
    if (direction < 0) { high = m - 1u; } else { low = m + 1u; }
  }
  return low;
}
fn roundedQuotient(a: f32, b: f32) -> f32 {
  let ab = bitcast<u32>(a); let bb = bitcast<u32>(b);
  let ea = i32((ab >> 23u) & 255u); let eb = i32((bb >> 23u) & 255u);
  let sign = (ab ^ bb) & 0x80000000u;
  if ((ab & 0x7fffffffu) == 0u && eb > 0 && eb < 255) { return bitcast<f32>(sign); }
  if (ea == 0 || eb == 0 || ea == 255 || eb == 255) { return a / b; }
  let ma = (ab & 0x7fffffu) | 0x800000u;
  let mb = (bb & 0x7fffffu) | 0x800000u;
  let shift = select(23u, 24u, ma < mb);
  var exponent = ea - eb + 127 - i32(shift - 23u);
  if (exponent <= 0 || exponent >= 255) { return a / b; }
  let estimate = u32((f32(ma) / f32(mb)) * f32(1u << shift));
  var m = arithmeticRound(estimate, arithmeticShift(ma, shift + 1u), mb);
  if (m == 0x1000000u) { m >>= 1u; exponent++; }
  if (exponent >= 255) { return a / b; }
  return bitcast<f32>(sign | (u32(exponent) << 23u) | (m & 0x7fffffu));
}
fn roundedRoot(a: f32) -> f32 {
  let bits = bitcast<u32>(a);
  if ((bits & 0x7fffffffu) == 0u) { return a; }
  let ea = i32(bits >> 23u);
  if (ea == 0 || ea >= 255) { return sqrt(a); }
  let ma = (bits & 0x7fffffu) | 0x800000u;
  let unbiased = ea - 127;
  let odd = u32(unbiased & 1);
  let shift = 23u + odd;
  var exponent = ((unbiased - i32(odd)) / 2) + 127;
  let estimate = u32(sqrt(f32(ma) * f32(1u << shift)));
  var m = arithmeticRound(estimate, arithmeticShift(ma, shift + 2u), 0u);
  if (m == 0x1000000u) { m >>= 1u; exponent++; }
  return bitcast<f32>((u32(exponent) << 23u) | (m & 0x7fffffu));
}
