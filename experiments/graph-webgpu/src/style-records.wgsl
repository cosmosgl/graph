struct Point {
  color: vec4f,
  metrics: vec4f,          // size, shape ID, stroke width, image size
  stroke: vec4f,
  ring: vec4f,             // negative alpha when there is no outline
  effects: vec4f,           // opacity, greyed flag, brightness of grey mix, default-channel mask (RGBA, size)
  uv: vec4f,               // atlas bounds, negative for a missing image
}
struct Link {
  geometry: vec4f,         // point indices, width, pattern + 4 for arrowheads
  color: vec4f,
}

// Interpolate the continuous channels. Shape, glyph and edge membership switch to the new
// input, and derived stroke colours are evaluated against the interpolated point fill.
fn interpolatePoint(previous: Point, next: Point, time: f32, animateSize: f32) -> Point {
  var p = next;
  p.color = mix(previous.color,next.color,time);
  if (animateSize > 0.0) { p.metrics.x = mix(previous.metrics.x,next.metrics.x,time); }
  p.metrics.z = mix(previous.metrics.z,next.metrics.z,time);
  if (min(previous.stroke.a,next.stroke.a) >= 0.0) { p.stroke = mix(previous.stroke,next.stroke,time); }
  p.effects.x = mix(previous.effects.x,next.effects.x,time);
  return p;
}
fn interpolateLink(previous: Link, next: Link, time: f32, animateWidth: f32) -> Link {
  var edge = next;
  edge.color = mix(previous.color,next.color,time);
  if (animateWidth > 0.0) { edge.geometry.z = mix(previous.geometry.z,next.geometry.z,time); }
  return edge;
}
