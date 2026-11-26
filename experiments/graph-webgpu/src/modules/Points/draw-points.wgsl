struct Sprite {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) index: u32,
  @location(1) spriteUV: vec2f,
  @location(2) @interpolate(flat) sizes: vec2f,   // shape and image diameter
  @location(3) @interpolate(flat) stroke: vec4f,
  @location(4) @interpolate(flat) ring: vec4f,
  @location(5) @interpolate(flat) spriteRadius: f32,
  @location(6) @interpolate(flat) center: vec2f,
  @location(7) @interpolate(flat) originAndGradient: vec4f,
  @location(8) @interpolate(flat) slope: vec4f,
  @location(9) @interpolate(flat) color: vec4f,
}

// Subpixel ties round upward in WebGL's lower-left window coordinates.
fn snapSpriteEdge(edge: vec2f, subdivisions: f32) -> vec2f {
  let scaled = edge * subdivisions;
  return (floor(scaled) + step(vec2f(0.5), fract(scaled))) / subdivisions;
}

fn spriteVertex(vertex: u32, rank: u32) -> Sprite {
  var out: Sprite;
  let i = pointOrder[rank];
  let position = positions[i];
  out.position = vec4f(2,2,2,1);
  if (position.w > 0.5 && params.modes.x > 0.0) { return out; }
  let presence = visualPresence(i, position.w);
  if (presence <= 0.0) { return out; }
  let p = currentPoint(i, presence);
  let factor = params.point.x * params.camera.w * sizeZoom(params.point.y);
  out.sizes = max(p.metrics.xw * factor, vec2f(0));
  let diameter = max(out.sizes.x, out.sizes.y);
  out.index = i;
  if (diameter <= 0.0) { return out; }
  out.color = p.color;
  out.stroke = p.stroke;
  if (out.stroke.a < 0.0 && p.metrics.z > 0.0) {
    out.stroke = vec4f(effectShade(p.color.rgb, params.shades.x, params.shades.y), 1);
  }
  out.ring = p.ring;
  // -2 selects the per-fill OKLab shade, -1 disables the outline.
  if (p.ring.a < -1.5) { out.ring = vec4f(effectShade(p.color.rgb, params.shades.z, params.shades.w), 1); }
  let coreRadius = max(1.0, diameter) * 0.5;
  let outlined = p.ring.a != -1.0 || out.ring.a > 0.0;
  out.spriteRadius = select(coreRadius, coreRadius * 1.3 + 1.0, outlined);
  let corners = array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));
  let windowAxes = vec2f(1, -1);
  let center = screen(position.xy) * windowAxes;
  let corner = corners[vertex] * windowAxes;
  var edge: vec2f;
  if (applePointRaster) {
    // On Apple the point-coordinate origin and span use two different subpixel grids.
    // Snap each axis separately: a fractional center can produce a nonsquare span.
    let lower = center - out.spriteRadius;
    let upper = center + out.spriteRadius;
    let origin = snapSpriteEdge(lower, 256.0);
    let span = snapSpriteEdge(upper, 16.0) - snapSpriteEdge(lower, 16.0);
    if (any(span <= vec2f(0))) { return out; }
    out.originAndGradient = vec4f(origin, 1.0 / span);
    out.slope = tileSlope(span);
    let bound = select(origin, origin + span, corner > vec2f(0));
    // WebGL includes the bottom sample on a tie. Place the horizontal quad edge one
    // raster subpixel above the preceding sample to preserve that rule on both triangles.
    let precedingSample = ceil(bound.y - 0.5) - 0.5;
    edge = vec2f(bound.x, precedingSample + 1.0 / 256.0);
  } else if (swiftShaderPointRaster) {
    // SwiftShader projects the center and each corner independently onto a 1/16-pixel grid.
    // The half-pixel offset puts pixel samples at integer coordinates for rasterization.
    let viewport = params.pointViewport.zw;
    let halfViewport = viewport * params.camera.w * 0.5;
    let subpixelScale = halfViewport * 16.0;
    let subpixelOffset = subpixelScale - 8.0;
    let normalized = (position.xy - params.pointViewport.xy) * (2.0 / viewport);
    let ndc = normalized * params.pointProjection.xy + params.pointProjection.zw;
    let lowerLeft = round(ndc * subpixelScale + subpixelOffset) / 16.0 + 0.5;
    let windowOrigin = vec2f(0, halfViewport.y * 2.0);
    out.center = (lowerLeft - windowOrigin) * windowAxes;
    let cornerNdc = ndc + corner * out.spriteRadius / halfViewport;
    edge = ceil(round(cornerNdc * subpixelScale + subpixelOffset) / 16.0) - windowOrigin;
  } else {
    let snappedCenter = snapSpriteEdge(center, 256.0);
    edge = ceil(snappedCenter + corner * out.spriteRadius - 0.5);
    out.spriteUV = (edge - snappedCenter) / (2.0 * out.spriteRadius) + 0.5;
  }
  out.position = clip(edge * windowAxes);
  return out;
}

@vertex fn pointVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Sprite {
  return spriteVertex(vertex, instance);
}

// Later entries in the public paint order are nearer. Each point gets the
// same depth in both passes, strictly between the near plane and clear depth.
fn rankedSprite(vertex: u32, rank: u32) -> Sprite {
  var out = spriteVertex(vertex, rank);
  out.position.z = (params.modes.z - f32(rank)) / (params.modes.z + 1.0);
  return out;
}

@vertex fn pointCoreVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Sprite {
  return rankedSprite(vertex, u32(params.modes.z) - 1u - instance);
}

@vertex fn pointFringeVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Sprite {
  return rankedSprite(vertex, instance);
}

fn shadePoint(input: Sprite) -> vec4f {
  let p = currentPoint(input.index, 1.0);
  let shape = u32(p.metrics.y);
  let radius = max(input.sizes.x, 1.0) * 0.5;
  var uv = input.spriteUV;
  if (swiftShaderPointRaster) {
    // SwiftShader samples the nominal diameter at the fragment's device-pixel
    // center relative to the full canvas.
    let pixel = input.position.xy + params.fragmentOffset;
    let inverseDiameter = 1.0 / (2.0 * input.spriteRadius);
    uv = (pixel - input.center) * inverseDiameter * vec2f(1, -1) + 0.5;
  }
  var orientedUV = vec2f(uv.x, 1.0 - uv.y);
  if (applePointRaster) {
    let height = round(params.pointViewport.w * params.camera.w);
    let windowOrigin = vec2f(0, height);
    let pixel = (input.position.xy + params.fragmentOffset) * vec2f(1, -1) + windowOrigin;
    orientedUV = applePointCoordinates(pixel, input.originAndGradient.xy + windowOrigin,
                                       input.originAndGradient.zw, input.slope);
  }
  let pointCoord = orientedUV * 2.0 - 1.0;
  let offset = pointCoord * input.spriteRadius;
  // An image-only point blends over transparent black, even if it has a configured fill.
  var color = vec3f(0);
  var alpha = 0.0;
  var coverage = 0.0;
  if (shape != 8u && input.sizes.x > 0.0) {
    let coreCoord = pointCoord * (input.spriteRadius / radius);
    var distance: f32;
    if (shape == 0u) {
      distance = length(coreCoord) * radius - radius;
    } else {
      distance = distanceToShape(coreCoord, shape) * radius;
    }
    coverage = 1.0 - smoothstep(-0.5,0.5,distance);
    color = input.color.rgb;
    alpha = coverage * input.color.a * min(1.0,input.sizes.x * input.sizes.x);
    let strokeWidth = clamp(p.metrics.z * params.camera.w,0.0,radius * inradius(shape) * 0.5);
    if (strokeWidth > 0.0) {
      let band = abs(distance + strokeWidth * 0.5) - strokeWidth * 0.5;
      color = mix(color,input.stroke.rgb,(1.0 - smoothstep(-0.5,0.5,band)) * input.stroke.a);
    }
  }
  var imageAlpha = 0.0;
  if (input.sizes.y > 0.0 && all(abs(offset) <= vec2f(input.sizes.y * 0.5))) {
    let halfTexel = 0.5 / vec2f(textureDimensions(atlas));
    let uv = mix(p.uv.xy,p.uv.zw,offset / input.sizes.y + vec2f(0.5));
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
    let outer = min(max(1.0,max(input.sizes.x,input.sizes.y)) * 0.65, input.spriteRadius - 0.5);
    let inner = outer * 0.9;
    let band = abs(length(offset) - (outer + inner) * 0.5) - max(outer - inner,1.0) * 0.5;
    let ringAlpha = input.ring.a * (1.0 - smoothstep(-0.5,0.5,band));
    let composed = ringAlpha + alpha * (1.0 - ringAlpha);
    if (composed > 0.0) { color = (input.ring.rgb * ringAlpha + color * alpha * (1.0 - ringAlpha)) / composed; }
    alpha = composed;
  }
  return vec4f(color,alpha);
}

@fragment fn pointFragment(input: Sprite) -> @location(0) vec4f {
  return shadePoint(input);
}

@fragment fn opaquePointFragment(input: Sprite) -> @location(0) vec4f {
  if (shadePoint(input).a != 1.0) { discard; }
  return vec4f(0);
}

@fragment fn pointCoreFragment(input: Sprite) -> @location(0) vec4f {
  let color = shadePoint(input);
  if (color.a != 1.0) { discard; }
  return color;
}
