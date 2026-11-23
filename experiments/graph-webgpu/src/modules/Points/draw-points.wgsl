struct Sprite {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) index: u32,
  @location(1) offset: vec2f,
  @location(2) @interpolate(flat) sizes: vec2f,   // shape and image diameter
  @location(3) @interpolate(flat) stroke: vec4f,
  @location(4) @interpolate(flat) ring: vec4f,
}

@vertex fn pointVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Sprite {
  var out: Sprite;
  let i = pointOrder[instance];
  let p = currentPoint(i);
  let position = positions[i];
  let factor = params.point.x * params.camera.w * sizeZoom(params.point.y);
  out.sizes = clamp(p.metrics.xw * factor, vec2f(0), vec2f(params.transition.w * params.camera.w));
  let diameter = max(out.sizes.x, out.sizes.y);
  out.index = i;
  out.position = vec4f(2,2,2,1);
  if (position.w > 0.5 || diameter <= 0.0) { return out; }
  out.stroke = p.stroke;
  if (out.stroke.a < 0.0 && p.metrics.z > 0.0) {
    out.stroke = vec4f(effectShade(p.color.rgb, params.shades.x, params.shades.y), 1);
  }
  out.ring = p.ring;
  // -2 selects the per-fill OKLab shade, -1 disables the outline.
  if (p.ring.a < -1.5) { out.ring = vec4f(effectShade(p.color.rgb, params.shades.z, params.shades.w), 1); }
  if (f32(i) == params.selected.x) { out.ring = params.hoverRing; }
  if (f32(i) == params.selected.y) { out.ring = params.focusRing; }
  let outer = select(1.0,1.3,out.ring.a > 0.0);
  let corners = array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));
  out.offset = corners[vertex] * (max(1.0,diameter) * outer * 0.5 + 1.0);
  out.position = clip(screen(position.xy) + out.offset);
  return out;
}

@fragment fn pointFragment(input: Sprite) -> @location(0) vec4f {
  let p = currentPoint(input.index);
  let shape = u32(p.metrics.y);
  let radius = max(input.sizes.x, 1.0) * 0.5;
  let distance = distanceToShape(input.offset / radius, shape) * radius;
  var coverage = 1.0 - smoothstep(-0.5,0.5,distance);
  if (shape == 8u || input.sizes.x <= 0.0) { coverage = 0.0; }
  var color = p.color.rgb;
  var alpha = coverage * p.color.a * min(1.0,input.sizes.x * input.sizes.x);
  let strokeWidth = clamp(p.metrics.z * params.camera.w,0.0,radius * inradius(shape) * 0.5);
  if (strokeWidth > 0.0) {
    let band = abs(distance + strokeWidth * 0.5) - strokeWidth * 0.5;
    color = mix(color,input.stroke.rgb,(1.0 - smoothstep(-0.5,0.5,band)) * input.stroke.a);
  }
  var imageAlpha = 0.0;
  if (input.sizes.y > 0.0 && all(abs(input.offset) <= vec2f(input.sizes.y * 0.5))) {
    let halfTexel = 0.5 / vec2f(textureDimensions(atlas));
    let uv = mix(p.uv.xy,p.uv.zw,input.offset / input.sizes.y + vec2f(0.5));
    let image = textureSampleLevel(atlas, atlasSampler, clamp(uv, p.uv.xy + halfTexel, p.uv.zw - halfTexel), 0.0);
    let imageRgb = select(image.rgb, mix(image.rgb,vec3f(p.effects.z),0.65),p.effects.y > 0.0);
    color = mix(color, imageRgb, image.a);
    alpha = max(alpha, image.a);
    imageAlpha = image.a;
  }
  alpha *= p.effects.x;
  if (params.modes.x > 0.0) {
    if (alpha <= 0.0 || (imageAlpha <= 0.0 && coverage < 0.5)) { discard; }
    return encodedId(input.index,params.point.z);
  }
  if (input.ring.a > 0.0) {
    let outer = max(1.0,max(input.sizes.x,input.sizes.y)) * 0.65;
    let inner = outer * 0.9;
    let band = abs(length(input.offset) - (outer + inner) * 0.5) - max(outer - inner,1.0) * 0.5;
    let ringAlpha = input.ring.a * (1.0 - smoothstep(-0.5,0.5,band));
    let composed = ringAlpha + alpha * (1.0 - ringAlpha);
    if (composed > 0.0) { color = (input.ring.rgb * ringAlpha + color * alpha * (1.0 - ringAlpha)) / composed; }
    alpha = composed;
  }
  return vec4f(color,alpha);
}
