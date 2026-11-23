struct Ribbon {
  @builtin(position) position: vec4f,
  @location(0) coord: vec2f,       // longitudinal fraction, signed distance across the strip
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) geometry: vec4f, // carrier width, body width, head width, head length
  @location(3) @interpolate(flat) span: f32,
  @location(4) @interpolate(flat) pattern: u32,
  @location(5) @interpolate(flat) index: u32,
}

fn conic(a: vec2f, b: vec2f, control: vec2f, t: f32) -> vec2f {
  let u = 1.0 - t;
  let w = 2.0 * u * t * params.curve.y;
  return (u*u*a + w*control + t*t*b) / (u*u + w + t*t);
}

@vertex fn linkVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Ribbon {
  var out: Ribbon;
  out.position = vec4f(2,2,2,1);
  let edge = currentLink(index);
  let source = u32(edge.geometry.x);
  let targetIndex = u32(edge.geometry.y);
  if (source >= u32(params.modes.z) || targetIndex >= u32(params.modes.z)) { return out; }
  let a = positions[source];
  let b = positions[targetIndex];
  let delta = b.xy - a.xy;
  let lengthWorld = length(delta);
  if (a.w > 0.5 || b.w > 0.5 || lengthWorld <= 0.0 || edge.geometry.z <= 0.0 || edge.color.a <= 0.0) { return out; }
  let steps = max(params.curve.x, 1.0);
  let t = f32(vertex / 2u) / steps;
  let across = select(-0.5,0.5,vertex % 2u > 0u);
  var current = mix(a.xy,b.xy,t);
  var tangent = delta;
  if (steps > 1.0) {
    let control = (a.xy + b.xy) * 0.5 + vec2f(-delta.y,delta.x) * params.curve.z;
    current = conic(a.xy,b.xy,control,t);
    tangent = conic(a.xy,b.xy,control,min(t + 1.0 / steps, 1.0))
            - conic(a.xy,b.xy,control,max(t - 1.0 / steps, 0.0));
  }
  let normal = normalize(vec2f(-tangent.y,-tangent.x));
  let lengthCss = lengthWorld * params.camera.z;
  var widthCss = min(edge.geometry.z * params.link.x * sizeZoom(params.link.y), params.transition.w);
  if (f32(index) == params.selected.z) { widthCss += params.widths.x; }
  if (f32(index) == params.selected.w) { widthCss += params.widths.y; }
  if (params.modes.x > 0.0 && steps > 1.0) { widthCss += params.curve.w; }
  if (widthCss <= 0.0) { return out; }
  let body = max(1.0,widthCss * params.camera.w);
  let arrow = edge.geometry.w >= 4.0;
  let head = select(body,max(body,body * params.modes.y * 2.0),arrow);
  let carrier = head + 1.0;
  out.position = clip(screen(current) + normal * (across * carrier));
  out.coord = vec2f(t, across * carrier);
  out.geometry = vec4f(carrier,body,head,select(0.0,min(0.3,1.73205 * head / (lengthCss * params.camera.w)),arrow));
  out.pattern = u32(edge.geometry.w) % 4u;
  out.span = lengthWorld * select(params.camera.z,1.0,params.link.y > 0.0);
  out.color = edge.color;
  if (params.visibility.w > 0.0) { out.color = vec4f(mix(currentPoint(source).color.rgb,currentPoint(targetIndex).color.rgb,t),out.color.a); }
  if (f32(index) == params.selected.z && params.hoverColor.a >= 0.0) { out.color = vec4f(params.hoverColor.rgb,out.color.a); }
  let fade = max(params.visibility.z,(params.visibility.y - lengthCss) / max(1e-6,params.visibility.y - params.visibility.x));
  let thin = select(1.0, min(1.0,widthCss * params.camera.w),params.link.w > 0.0);
  out.color.a *= params.link.z * fade * thin;
  out.index = index;
  return out;
}

@fragment fn linkFragment(input: Ribbon) -> @location(0) vec4f {
  let t = clamp(input.coord.x,0.0,1.0);
  let headLength = input.geometry.w;
  let headStart = 0.5 - headLength * 0.5;
  let headEnd = 0.5 + headLength * 0.5;
  let inHead = t > headStart && t < headEnd;
  var halfWidth = input.geometry.y * 0.5;
  if (inHead) { halfWidth = max(halfWidth, input.geometry.z * 0.5 * ((headEnd - t) / headLength)); }
  let distance = abs(input.coord.y) - halfWidth;
  var coverage = 1.0 - smoothstep(-0.5,0.5,distance);
  // Both pointer and host picking cover the entire stroke, including dash gaps.
  if (params.modes.x > 0.0) {
    if (coverage < 0.5 || input.color.a <= 0.0) { discard; }
    return encodedId(input.index + u32(params.point.w),params.modes.w);
  }
  let phase = t * input.span;
  let phaseAA = max(fwidth(phase) * 0.5,1e-4);
  if (!inHead && input.pattern == 1u) {
    let period = max(params.widths.z + params.widths.w,0.001);
    let m = phase - floor(phase / period) * period;
    coverage *= smoothstep(-phaseAA,phaseAA,m) * (1.0 - smoothstep(params.widths.z-phaseAA,params.widths.z+phaseAA,m));
  } else if (!inHead && input.pattern == 2u) {
    let unitsPerPixel = 1.0 / (params.camera.w * select(1.0,params.camera.z,params.link.y > 0.0));
    let diameter = input.geometry.y * unitsPerPixel;
    let period = max(diameter + params.widths.w,0.001);
    let r = diameter * 0.5;
    let m = phase - floor(phase / period) * period;
    let d = length(vec2f(m-r,input.coord.y * unitsPerPixel)) - r;
    coverage *= 1.0 - smoothstep(-phaseAA,phaseAA,d);
  }
  let alpha = input.color.a * coverage;
  if (params.link.w <= 0.0) {
    if (coverage < 0.5 || alpha <= 0.0) { discard; }
    return vec4f(input.color.rgb,1.0);
  }
  return vec4f(input.color.rgb,alpha);
}
