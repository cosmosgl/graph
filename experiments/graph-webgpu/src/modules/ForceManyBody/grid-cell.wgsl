// The fitted box stores its reciprocal once. Scaling it by a power of two makes
// every finer cell a child of the coarser cell, including at clipped edges.
fn gridCell(position: vec2f, width: u32, box: vec4f) -> vec2u {
  let scaled = (position - box.xy) * (box.w * f32(width));
  return vec2u(clamp(floor(scaled), vec2f(0.0), vec2f(f32(width - 1u))));
}
