// Keep the separation, squared length, and force scale in high/low pairs.
// This defers float32 rounding to the force output, like the CPU reference.
fn expandedMouseForce(point: vec2f, pointer: vec3f) -> vec2f {
  let dx = sub_fp64(vec2f(point.x, 0.), vec2f(pointer.x, 0.));
  let dy = sub_fp64(vec2f(point.y, 0.), vec2f(pointer.y, 0.));
  let squared = sum_fp64(mul_fp64(dx, dx), mul_fp64(dy, dy));
  let distance = sqrt_fp64(squared);
  let insideClamp = squared.x < 100. || (squared.x == 100. && squared.y < 0.);
  let boundedSquared = select(squared, vec2f(100., 0.), insideClamp);
  let numerator = mul_fp64(vec2f(100., 0.), vec2f(pointer.z, 0.));
  let denominator = mul_fp64(distance, boundedSquared);
  // A distant point can have a representable force even when the shared
  // scale would underflow. Apply its displacement before the division here.
  if (abs(numerator.x) < denominator.x * bitcast<f32>(0x00800000u)) {
    return vec2f(div_fp64(mul_fp64(dx, numerator), denominator).x, div_fp64(mul_fp64(dy, numerator), denominator).x);
  }
  let scale = div_fp64(numerator, denominator);
  return vec2f(mul_fp64(dx, scale).x, mul_fp64(dy, scale).x);
}
