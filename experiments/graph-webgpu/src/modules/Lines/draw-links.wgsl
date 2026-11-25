struct Ribbon {
  @builtin(position) position: vec4f,
  @location(0) coord: vec2f,      // curve parameter, signed fraction across the strip
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) geometry: vec4f, // ramp/strip, arrow width fraction, arrow length, dash width
  @location(3) @interpolate(flat) span: f32,
  @location(4) @interpolate(flat) style: u32, // pattern + 4 for arrowheads
  @location(5) @interpolate(flat) index: u32,
  @location(6) @interpolate(flat) sourceColor: vec3f,
  @location(7) @interpolate(flat) targetColor: vec3f,
}

fn conic(a: vec2f, b: vec2f, control: vec2f, t: f32, weight: f32) -> vec2f {
  let u = 1.0 - t;
  let w = 2.0 * u * t * weight;
  return (u*u*a + w*control + t*t*b) / (u*u + w + t*t);
}

fn swiftWindowRow(worldY: f32, targetRatio: f32) -> f32 {
  let screenY = -worldY * params.camera.z + params.camera.y;
  return round(((params.pointViewport.w - screenY) * targetRatio - 0.5) * 16.0);
}

fn linkRibbon(vertex: u32, index: u32) -> Ribbon {
  var out: Ribbon;
  out.position = vec4f(2,2,2,1);
  let edge = currentLink(index);
  let source = u32(edge.geometry.x);
  let targetIndex = u32(edge.geometry.y);
  if (source >= u32(params.modes.z) || targetIndex >= u32(params.modes.z)) { return out; }
  let a = positions[source];
  let b = positions[targetIndex];
  if (params.modes.x > 0.0 && (a.w > 0.5 || b.w > 0.5)) { return out; }
  let sourcePresence = visualPresence(source, a.w);
  let targetPresence = visualPresence(targetIndex, b.w);
  let presence = sourcePresence * targetPresence;
  if (presence <= 0.0) { return out; }
  let delta = b.xy - a.xy;
  let lengthWorld = length(delta);
  let baseWidth = edge.geometry.z * params.link.x;
  if (lengthWorld <= 0.0 || baseWidth <= 0.0 || edge.color.a <= 0.0) { return out; }

  let zoom = params.camera.z;
  let ratio = params.camera.w;
  let steps = params.curve.x;
  // The WebGL strip samples a signed quadratic on [-1, 1], then stores t as
  // float32. Dividing only at the end avoids rounding the parameter twice.
  let signedStep = 2.0 * f32(vertex / 2u) - steps;
  let stepsSquared = steps * steps;
  let t = (stepsSquared + signedStep * abs(signedStep)) / (2.0 * stepsSquared);
  let across = select(0.5, -0.5, vertex % 2u > 0u);
  var point = mix(a.xy,b.xy,t);
  var tangent = delta;
  if (steps > 1.0) {
    let perp = normalize(vec2f(-delta.y,delta.x));
    let control = (a.xy + b.xy) * 0.5 + perp * lengthWorld * params.curve.z;
    point = conic(a.xy,b.xy,control,t,params.curve.y);
    tangent = conic(a.xy,b.xy,control,min(1.0,t + 1.0 / steps),params.curve.y)
            - conic(a.xy,b.xy,control,max(0.0,t - 1.0 / steps),params.curve.y);
  }

  let arrow = edge.geometry.w >= 4.0;
  let arrowWidth = baseWidth * 2.0 * params.modes.y;
  let width = select(baseWidth, max(baseWidth,arrowWidth), arrow);
  let arrowFraction = max(0.0,arrowWidth - baseWidth) / width;
  let fixedScale = clamp(zoom * 0.01, 1.0, 5.0);
  let scalesWithZoom = params.link.y > 0.0;
  let scaled = select(width / zoom * fixedScale, width, scalesWithZoom);
  var widthWorld = min(scaled, params.transition.w * select(1.0,2.0,arrow) / zoom);
  if (params.modes.x > 0.0) { widthWorld += params.curve.w / zoom; }
  if (f32(index) == params.selected.z) { widthWorld += params.widths.x / zoom; }
  if (f32(index) == params.selected.w) { widthWorld += params.widths.y / zoom; }

  let ramp = (1.0 / ratio) / zoom;
  let blended = params.link.w > 0.0;
  let bodyShare = select(1.0,1.0 - arrowFraction,arrow);
  let minWidth = select(ramp / bodyShare,ramp,blended);
  let carrier = max(widthWorld,minWidth) + ramp;
  let unit = select(zoom,1.0,scalesWithZoom);
  let scaledArrow = select(arrowWidth / zoom * fixedScale,arrowWidth,scalesWithZoom);
  out.geometry = vec4f(ramp / carrier, arrowFraction, min(0.3, (0.866 * scaledArrow * 2.0) / lengthWorld), carrier * unit);
  out.span = lengthWorld * unit;
  out.coord = vec2f(t,across);
  out.style = u32(edge.geometry.w);
  out.index = index;

  let normal = normalize(vec2f(-tangent.y,tangent.x));
  let world = point + normal * carrier * across;
  let normalized = (world - params.pointViewport.xy) * (2.0 / params.pointViewport.zw);
  var ndc = normalized * params.pointProjection.xy + params.pointProjection.zw;
  if (swiftShaderQuad && steps == 1.0 && delta.x == 0.0) {
    // Vertical strokes have horizontal caps. On a sample-center tie WebGL
    // includes the bottom row, while WebGPU includes the top. Move that cap
    // one raster subpixel down, preserving the original gradient/dash slope.
    let targetRatio = select(ratio, 1.0, params.modes.x == 2.0);
    let row = swiftWindowRow(point.y, targetRatio);
    if ((i32(row) & 15) == 0) {
      let otherY = select(a.y, b.y, t == 0.0);
      let otherRow = swiftWindowRow(otherY, targetRatio);
      let span = select(row - otherRow, otherRow - row, t == 0.0);
      if (span != 0.0) {
        let subpixelScale = params.pointViewport.w * targetRatio * 8.0;
        ndc.y = (row - 1.0 - (subpixelScale - 8.0)) / subpixelScale;
        out.coord.x -= 1.0 / span;
      }
    }
  }
  out.position = vec4f(ndc,0,1);
  if (params.modes.x == 2.0) {
    // WebGL's pointer index target has one texel per CSS pixel at every DPR.
    // The pointer pass reserves a single texel for the link below its point-picking window.
    let pixel = (ndc * vec2f(0.5,-0.5) + 0.5) * params.pointViewport.zw - params.linkPickPixel;
    out.position = vec4f(pixel * vec2f(2,-2) + vec2f(-1,1),0,1);
  }

  let lengthCss = lengthWorld * zoom;
  let fade = max(params.visibility.z, (lengthCss - params.visibility.y) / (params.visibility.x - params.visibility.y));
  let thin = select(1.0, min(widthWorld / ramp,1.0), blended);
  out.color = vec4f(edge.color.rgb,edge.color.a * params.link.z * fade * thin * presence);
  if (params.visibility.w > 0.0) {
    // Like the WebGL endpoint color texture, gradients read the current data.
    // Only default channels follow the endpoint's presence.
    out.sourceColor = applyPresence(points[source], sourcePresence).color.rgb;
    out.targetColor = applyPresence(points[targetIndex], targetPresence).color.rgb;
  }
  return out;
}

@vertex fn linkVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Ribbon {
  return linkRibbon(vertex, index);
}

// A solid blended stroke needs only the signed distance across the same strip,
// its antialiasing width and its color. Keep this interface small on tile GPUs.
struct SolidRibbon {
  @builtin(position) position: vec4f,
  @location(0) across: f32,
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) smoothing: f32,
}

@vertex fn solidLinkVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> SolidRibbon {
  let ribbon = linkRibbon(vertex, index);
  return SolidRibbon(ribbon.position, ribbon.coord.y, ribbon.color, ribbon.geometry.x);
}

fn dotDistance(coord: vec2f, span: f32, width: f32, period: f32) -> f32 {
  let phase = clamp(coord.x, 0.0, 1.0) * span;
  let along = phase - floor(phase / period) * period - period * 0.5;
  return length(vec2f(along, coord.y * width));
}

// WGSL smoothstep requires increasing bounds. Keep the WebGL edge's order
// of operations so half-coverage decisions and blending agree at float32 ties.
fn fallingRamp(high: f32, low: f32, sample: f32) -> f32 {
  if (low >= high) { return select(0.0, 1.0, sample <= high); }
  let t = clamp((sample - high) / (low - high), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

@fragment fn solidLinkFragment(input: SolidRibbon) -> @location(0) vec4f {
  let coverage = fallingRamp(0.5, 0.5 - input.smoothing, abs(input.across));
  return vec4f(input.color.rgb, input.color.a * coverage);
}

// Keep the same vertex and interpolants as the general solid pass. A draw-wide
// color needs only the per-link faded alpha in the fragment shader.
@fragment fn uniformRgbLinkFragment(input: SolidRibbon) -> @location(0) vec4f {
  let coverage = fallingRamp(0.5, 0.5 - input.smoothing, abs(input.across));
  return vec4f(params.uniformLinkRgb, input.color.a * coverage);
}

@fragment fn linkFragment(input: Ribbon) -> @location(0) vec4f {
  let t = input.coord.x;
  let side = abs(input.coord.y);
  let smoothing = input.geometry.x;
  let arrowLength = input.geometry.z;
  let arrowEnd = 0.5 + arrowLength * 0.5;
  let arrowStart = arrowEnd - arrowLength;
  let arrow = input.style >= 4u;
  let inHead = arrow && t > arrowStart && t < arrowEnd;
  var coverage = fallingRamp(0.5, 0.5 - smoothing, side);
  if (arrow) {
    let bodyEdge = (0.5 - input.geometry.y * 0.5) * (1.0 - smoothing);
    let halfRamp = smoothing * 0.5;
    coverage = fallingRamp(bodyEdge + halfRamp, bodyEdge - halfRamp, side);
    if (inHead) {
      let taper = 0.5 * (1.0 - smoothing) * (1.0 - (t - arrowStart) / (arrowEnd - arrowStart));
      coverage = max(coverage,1.0 - smoothstep(taper-halfRamp,taper+halfRamp,side));
    }
  }
  let hovered = f32(input.index) == params.selected.z && params.hoverColor.a >= 0.0;
  if (params.modes.x > 0.0) {
    if (params.modes.x == 2.0) {
      // The engine's pointer index pass includes the antialiased fringe and dash gaps.
      if (input.color.a * coverage <= 0.0 || (hovered && params.hoverColor.a == 0.0)) { discard; }
    } else if (coverage < 0.5 || input.color.a <= 0.0) { discard; }
    return encodedId(input.index + u32(params.point.w),params.modes.w);
  }

  let pattern = input.style % 4u;
  // Style is flat across the primitive. Evaluate pattern derivatives across the
  // entire triangle, including helpers, before selecting the solid arrowhead.
  @diagnostic(off, derivative_uniformity)
  if (pattern == 1u || pattern == 2u) {
    let phase = clamp(t, 0.0, 1.0) * input.span;
    var phaseDx = dpdx(phase);
    let phaseDy = dpdy(phase);
    var left: vec2f;
    var right: vec2f;
    if (swiftShaderQuad) {
      // SwiftShader takes coarse dFdx from the first row in its 2×2 quad.
      // The WebGL viewport starts at the bottom. Reconstruct that row in the
      // WebGPU quad before applying the nonlinear clamp and dot distance.
      let dx = dpdx(input.coord);
      let dy = dpdy(input.coord);
      let lane = vec2f(vec2u(input.position.xy) % 2u);
      left = input.coord - lane.x * dx + (1.0 - lane.y) * dy;
      right = left + dx;
      phaseDx = (clamp(right.x, 0.0, 1.0) * input.span) - (clamp(left.x, 0.0, 1.0) * input.span);
    }
    var mask: f32;
    if (pattern == 1u) {
      let aa = max(abs(phaseDx) + abs(phaseDy), 1e-4) * 0.5;
      let period = max(params.widths.z + params.widths.w, 0.001);
      let m = phase - floor(phase / period) * period;
      mask = smoothstep(-aa, aa, m) * (1.0 - smoothstep(params.widths.z - aa, params.widths.z + aa, m));
    } else {
      var diameter = input.geometry.w * (1.0 - smoothing);
      if (params.link.w <= 0.0) {
        diameter = max(diameter, 1.4142136 * max(length(vec2f(phaseDx, phaseDy)), 1e-4));
      }
      let period = max(diameter + params.widths.w, 0.001);
      let radial = dotDistance(input.coord, input.span, input.geometry.w, period);
      var radialDx = dpdx(radial);
      if (swiftShaderQuad) {
        radialDx = dotDistance(right, input.span, input.geometry.w, period)
                 - dotDistance(left, input.span, input.geometry.w, period);
      }
      let aa = max(abs(radialDx) + abs(dpdy(radial)), 1e-4) * 0.5;
      mask = 1.0 - smoothstep(diameter * 0.5 - aa, diameter * 0.5 + aa, radial);
    }
    if (!inHead) { coverage *= mask; }
  }

  var color = input.color.rgb;
  if (params.visibility.w > 0.0) { color = mix(input.sourceColor,input.targetColor,clamp(t,0.0,1.0)); }
  var alpha = input.color.a * coverage;
  if (hovered) { color = params.hoverColor.rgb; alpha *= params.hoverColor.a; }
  if (params.link.w <= 0.0) {
    if (coverage < 0.5 || alpha <= 0.0) { discard; }
    return vec4f(color,1.0);
  }
  return vec4f(color,alpha);
}
