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
fn effectGrey(rgb: vec3f) -> vec3f {
  let greyTarget = select(max(params.background.rgb,vec3f(0.8)),vec3f(0.2),params.effects.y > 0.0);
  return mix(rgb,greyTarget,0.65);
}
fn effectFill(p: Point) -> vec4f {
  if (p.status.x <= 0.0) { return p.color; }
  if (params.greyoutColor.r >= 0.0) { return params.greyoutColor; }
  return vec4f(effectGrey(p.color.rgb),p.color.a);
}
fn effectOpacity(p: Point) -> f32 {
  return select(params.style.z,params.effects.x,p.status.x > 0.0 && params.effects.x >= 0.0);
}
