fn inradius(shape: u32) -> f32 {
  switch shape {
    case 1u: { return 0.8; } case 2u: { return 0.9 / sqrt(3.0); }
    case 3u: { return 0.8 * 1.2 / sqrt(1.2 * 1.2 + 1.0); }
    case 4u: { return 0.726542528; } case 5u: { return 0.8; }
    case 6u: { return 0.9 * 0.45; } case 7u: { return 0.3; } default: { return 1.0; }
  }
}
// Production signed-distance geometry, expressed in WGSL. coord has the same
// top-to-bottom y direction as gl_PointCoord; world-space y remains upward in GLSL.
fn distanceToShape(coord: vec2f, shape: u32) -> f32 {
  var p = coord;
  switch shape {
    case 1u: {
      let d = abs(p) - vec2f(0.8);
      return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
    }
    case 2u: {
      let k = sqrt(3.0); let r = 0.9;
      p.x = abs(p.x) - r; p.y += 0.55;
      if (p.x + k * p.y > 0.0) { p = vec2f(p.x - k * p.y, -k * p.x - p.y) / 2.0; }
      p.x -= clamp(p.x, -2.0 * r, 0.0);
      return -length(p) * sign(p.y);
    }
    case 3u: {
      let b = vec2f(0.8, 0.8 * 1.2); p = abs(p);
      let h = clamp(((b.x - 2.0 * p.x) * b.x - (b.y - 2.0 * p.y) * b.y) / dot(b,b), -1.0, 1.0);
      return length(p - 0.5 * b * vec2f(1.0 - h, 1.0 + h)) * sign(p.x * b.y + p.y * b.x - b.x * b.y);
    }
    case 4u: {
      let k = vec3f(0.809016994, 0.587785252, 0.726542528); let r = 0.726542528;
      p.x = abs(p.x);
      p -= 2.0 * min(dot(vec2f(-k.x, k.y), p), 0.0) * vec2f(-k.x, k.y);
      p -= 2.0 * min(dot(vec2f(k.x, k.y), p), 0.0) * vec2f(k.x, k.y);
      p -= vec2f(clamp(p.x, -r * k.z, r * k.z), r);
      return length(p) * sign(p.y);
    }
    case 5u: {
      let k = vec3f(-0.866025404, 0.5, 0.577350269); p = abs(p);
      p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
      p -= vec2f(clamp(p.x, -k.z * 0.8, k.z * 0.8), 0.8);
      return length(p) * sign(p.y);
    }
    case 6u: {
      let k1 = vec2f(0.809016994, -0.587785252); let k2 = vec2f(-k1.x, k1.y);
      p.x = abs(p.x);
      p -= 2.0 * max(dot(k1,p), 0.0) * k1;
      p -= 2.0 * max(dot(k2,p), 0.0) * k2;
      p.x = abs(p.x); p.y -= 0.9;
      let ba = 0.45 * vec2f(-k1.y, k1.x) - vec2f(0.0,1.0);
      let h = clamp(dot(p,ba) / dot(ba,ba), 0.0, 0.9);
      return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
    }
    case 7u: {
      p = abs(p); if (p.y > p.x) { p = p.yx; }
      let q = p - vec2f(0.8,0.3);
      return length(max(q,vec2f(0.0))) + min(max(q.x,q.y),0.0);
    }
    default: { return length(p) - 1.0; }
  }
}
// Production OKLab color policy, expressed in WGSL. GLSL control stays imported.
fn effectLinear(c: vec3f) -> vec3f {
  return mix(c / 12.92,pow((c + 0.055) / 1.055,vec3f(2.4)),step(vec3f(0.04045),c));
}
fn effectSrgb(value: vec3f) -> vec3f {
  let c = clamp(value,vec3f(0),vec3f(1));
  return mix(c * 12.92,1.055 * pow(c,vec3f(1.0/2.4)) - 0.055,step(vec3f(0.0031308),c));
}
fn effectLab(rgb: vec3f) -> vec3f {
  var lms = mat3x3f(vec3f(0.4122214708,0.2119034982,0.0883024619),vec3f(0.5363325363,0.6806995451,0.2817188376),
    vec3f(0.0514459929,0.1073969566,0.6299787005)) * effectLinear(rgb);
  lms = sign(lms) * pow(abs(lms),vec3f(1.0/3.0));
  return mat3x3f(vec3f(0.2104542553,1.9779984951,0.0259040371),vec3f(0.7936177850,-2.4285922050,0.7827717662),
    vec3f(-0.0040720468,0.4505937099,-0.8086757660)) * lms;
}
fn effectLabToLinear(lab: vec3f) -> vec3f {
  let lms = mat3x3f(vec3f(1,1,1),vec3f(0.3963377774,-0.1055613458,-0.0894841775),vec3f(0.2158037573,-0.0638541728,-1.2914855480)) * lab;
  return mat3x3f(vec3f(4.0767416621,-1.2684380046,-0.0041960863),vec3f(-3.3077115913,2.6097574011,-0.7034186147),
    vec3f(0.2309699292,-0.3413193965,1.7076147010)) * (lms * lms * lms);
}
fn effectInGamut(v: vec3f) -> bool { return all(v >= vec3f(-0.0001)) && all(v <= vec3f(1.0001)); }
fn effectShade(rgb: vec3f, direction: f32, contrast: f32) -> vec3f {
  var lab = effectLab(rgb); var d = direction;
  if (d == 0.0) { d = select(1.0,-1.0,lab.x > 0.6); }
  lab.x = clamp(lab.x + d * contrast,0.0,1.0);
  if (!effectInGamut(effectLabToLinear(lab))) {
    var low = 0.0; var high = 1.0;
    for (var i = 0u; i < 8u; i++) {
      let mid = 0.5 * (low + high);
      if (effectInGamut(effectLabToLinear(vec3f(lab.x,lab.yz * mid)))) { low = mid; } else { high = mid; }
    }
    lab = vec3f(lab.x,lab.yz * low);
  }
  return effectSrgb(effectLabToLinear(lab));
}
