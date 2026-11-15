// Device-pixel SDF diagnostic. Production and normalized controls are retained.
fn polygonPixelDistance(offset: vec2f, core: f32, shape: u32, shapeBounds: vec2f) -> f32 {
  let radius = core * 0.5; var p = offset;
  if (shape == 2u) {
    let r = shapeBounds.x; let k = sqrt(3.0);
    p.x = abs(p.x) - r; p.y += shapeBounds.y;
    if (p.x + k * p.y > 0.0) { p = vec2f(p.x - k * p.y,-k * p.x - p.y) / 2.0; }
    p.x -= clamp(p.x,-2.0 * r,0.0);
    return -length(p) * sign(p.y);
  }
  if (shape == 3u) {
    let b = vec2f(0.8,0.96) * radius; p = abs(p);
    let h = clamp(((b.x - 2.0 * p.x) * b.x - (b.y - 2.0 * p.y) * b.y) / dot(b,b),-1.0,1.0);
    let d = length(p - 0.5 * b * vec2f(1.0 - h,1.0 + h));
    return d * sign(30.0 * p.x + 25.0 * p.y - 12.0 * core);
  }
  let k1 = vec2f(0.809016994,-0.587785252); let k2 = vec2f(-k1.x,k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1,p),0.0) * k1;
  p -= 2.0 * max(dot(k2,p),0.0) * k2;
  p.x = abs(p.x); p.y -= shapeBounds.x;
  let ba = 0.45 * vec2f(-k1.y,k1.x) - vec2f(0.0,1.0);
  let h = clamp(dot(p,ba) / dot(ba,ba),0.0,shapeBounds.x);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
