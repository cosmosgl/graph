fn refinedDivide(a: f32, b: f32) -> f32 {
  let q = a / b;
  return q + fma(-q, b, a) / b;
}
fn refinedRoot(a: f32) -> f32 {
  let q = sqrt(a);
  return q + fma(-q, q, a) / (2. * q);
}
fn farPairVelocity(delta: vec2<f32>, randomDir: vec2<f32>, mass: f32) -> vec2<f32> {
  let squared = roundedSquare(delta.x) + roundedSquare(delta.y);
  if (squared <= 0.) { return vec2(0.); }
  let root = refinedRoot(squared);
  var denominator = root;
  if (squared < 1.) { denominator = refinedRoot(root); }
  let magnitude = refinedDivide(params.alpha * params.repulsion * mass, denominator);
  let direction = vec2(refinedDivide(delta.x, root), refinedDivide(delta.y, root));
  return magnitude * direction;
}
