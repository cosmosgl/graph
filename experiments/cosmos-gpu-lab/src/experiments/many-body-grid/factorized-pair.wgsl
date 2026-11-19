// The original force is strength / |d| multiplied by normalize(d).
// For squared distances >= 1 this is algebraically d * strength / dot(d, d),
// so the common path needs no square root. The softened path remains native.
fn factorizedPairVelocity(delta: vec2<f32>, randomDir: vec2<f32>, mass: f32) -> vec2<f32> {
  var dist = delta; var squared = dot(dist, dist);
  if (squared <= 0.) { dist = randomDir; squared = dot(dist, dist); if (squared <= 0.) { return vec2(0.); } }
  let strength = params.alpha * params.repulsion * mass;
  if (squared >= 1.) { return dist * (strength / squared); }
  let softened = sqrt(squared);
  return (strength / sqrt(softened)) * normalize(dist);
}
