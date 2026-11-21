// Diagnostic only: same shape dimensions in device pixels. No boundary epsilon.
float polygonPixelDistance(vec2 offset, float core, float shape, vec2 shapeBounds) {
  float radius = core * 0.5;
  vec2 p = offset;
  if (shape == 2.0) {
    float r = shapeBounds.x;
    p.x = abs(p.x) - r; p.y += shapeBounds.y;
    float k = sqrt(3.0);
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }
  if (shape == 3.0) {
    vec2 b = vec2(0.8, 0.96) * radius; p = abs(p);
    float h = clamp(((b.x - 2.0 * p.x) * b.x - (b.y - 2.0 * p.y) * b.y) / dot(b,b), -1.0, 1.0);
    float d = length(p - 0.5 * b * vec2(1.0 - h,1.0 + h));
    // Half-diagonals are 2*core/5 and 12*core/25. Clear their
    // denominators before evaluating the sign: 30*x + 25*y - 12*core.
    return d * sign(30.0 * p.x + 25.0 * p.y - 12.0 * core);
  }
  const vec2 k1 = vec2(0.809016994, -0.587785252);
  const vec2 k2 = vec2(-k1.x,k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1,p),0.0) * k1;
  p -= 2.0 * max(dot(k2,p),0.0) * k2;
  p.x = abs(p.x); p.y -= shapeBounds.x;
  vec2 ba = 0.45 * vec2(-k1.y,k1.x) - vec2(0.0,1.0);
  float h = clamp(dot(p,ba) / dot(ba,ba),0.0,shapeBounds.x);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
