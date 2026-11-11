// Small-angle Taylor polynomials evaluated with luma's public high/low arithmetic.
// Domain: gravity angles around [-pi, pi]. Triple-split constants preserve reduction near axes.
struct GravitySinCos { sine: vec2f, cosine: vec2f }
fn gravitySinCos(angle: vec2f) -> GravitySinCos {
  if (angle.x == 0. && angle.y == 0.) { return GravitySinCos(vec2f(angle.x, 0.), vec2f(1., 0.)); }
  let quadrant = clamp(i32(round(angle.x * 0.6366197723675814)), -2, 2);
  var reduced = angle;
  if (abs(quadrant) == 1) {
    let sign = select(-1., 1., quadrant > 0);
    reduced = sub_fp64(reduced, vec2f(1.5707963705062866, -4.3711388286737929e-08) * sign);
    reduced = sub_fp64(reduced, vec2f(-1.7151245100058819e-15 * sign, 0.));
  }
  if (abs(quadrant) == 2) {
    let sign = select(-1., 1., quadrant > 0);
    reduced = sub_fp64(reduced, vec2f(3.1415927410125732, -8.7422776573475858e-08) * sign);
    reduced = sub_fp64(reduced, vec2f(-3.4302490200117637e-15 * sign, 0.));
  }
  let square = mul_fp64(reduced, reduced);
  var sine = vec2f(2.8114573589663704e-15, -1.0462084739763658e-22);
  sine = sum_fp64(mul_fp64(sine, square), vec2f(-7.6471636098127127e-13, -1.2200710471178288e-20));
  sine = sum_fp64(mul_fp64(sine, square), vec2f(1.6059044372074283e-10, -5.3525265115627256e-18));
  sine = sum_fp64(mul_fp64(sine, square), vec2f(-2.5052107943679403e-08, -4.4176230446483665e-16));
  sine = sum_fp64(mul_fp64(sine, square), vec2f(2.7557318844628753e-06, 3.7935712242972291e-14));
  sine = sum_fp64(mul_fp64(sine, square), vec2f(-0.00019841270113829523, 2.7255968749334558e-12));
  sine = sum_fp64(mul_fp64(sine, square), vec2f(0.0083333337679505348, -4.3461720333759502e-10));
  sine = sum_fp64(mul_fp64(sine, square), vec2f(-0.1666666716337204, 4.9670538793122887e-09));
  sine = sum_fp64(mul_fp64(sine, square), vec2f(1, 0));
  sine = mul_fp64(sine, reduced);
  var cosine = vec2f(4.7794772561329454e-14, 7.6254440444864298e-22);
  cosine = sum_fp64(mul_fp64(cosine, square), vec2f(-1.147074536050896e-11, -2.3722076892312381e-19));
  cosine = sum_fp64(mul_fp64(cosine, square), vec2f(2.0876755879584152e-09, 1.1082839809204342e-16));
  cosine = sum_fp64(mul_fp64(cosine, square), vec2f(-2.755731998149713e-07, 7.5751122090511949e-15));
  cosine = sum_fp64(mul_fp64(cosine, square), vec2f(2.4801587642286904e-05, -3.4069960936668198e-13));
  cosine = sum_fp64(mul_fp64(cosine, square), vec2f(-0.0013888889225199819, 3.3631094437103215e-11));
  cosine = sum_fp64(mul_fp64(cosine, square), vec2f(0.041666667908430099, -1.2417634698280722e-09));
  cosine = sum_fp64(mul_fp64(cosine, square), vec2f(-0.5, 0));
  cosine = sum_fp64(mul_fp64(cosine, square), vec2f(1, 0));
  if (quadrant == 1) { return GravitySinCos(cosine, -sine); }
  if (quadrant == -1) { return GravitySinCos(-cosine, sine); }
  if (abs(quadrant) == 2) { return GravitySinCos(-sine, -cosine); }
  return GravitySinCos(sine, cosine);
}
// atan(r) = r - r^3/3 + r^5/5 corrects the cross/dot residual; native atan2 is only a seed.
fn gravityAngle(y: f32, x: f32) -> f32 {
  let sign = bitcast<u32>(y) & 0x80000000u;
  if (y == 0.) { return bitcast<f32>(sign | select(0u, 0x40490fdbu, x < 0.)); }
  if (x == 0.) { return bitcast<f32>(sign | 0x3fc90fdbu); }
  let estimate = atan2(y, x);
  let sc = gravitySinCos(vec2f(estimate, 0.));
  let cross = sub_fp64(mul_fp64(vec2f(y, 0.), sc.cosine), mul_fp64(vec2f(x, 0.), sc.sine));
  let dot = sum_fp64(mul_fp64(vec2f(x, 0.), sc.cosine), mul_fp64(vec2f(y, 0.), sc.sine));
  let ratio = div_fp64(cross, dot);
  let squaredRatio = mul_fp64(ratio, ratio);
  let correction = mul_fp64(ratio, sum_fp64(vec2f(1., 0.),
    mul_fp64(squaredRatio, sum_fp64(vec2f(-0.3333333432674408, 9.9341077586245774e-09), mul_fp64(squaredRatio, vec2f(0.20000000298023224, -2.9802322831784522e-09))))));
  return sum_fp64(vec2f(estimate, 0.), correction).x;
}
