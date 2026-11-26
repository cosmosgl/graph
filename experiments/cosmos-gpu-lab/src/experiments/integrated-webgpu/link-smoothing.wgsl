struct SmoothLinkVertex {
  @builtin(position) position: vec4f,
  @location(0) across: f32,
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) smoothing: f32,
  @location(3) @interpolate(flat) id: u32,
}

@vertex fn smoothLinkVertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> SmoothLinkVertex {
  let edge = links[i];
  let a = positions[edge.x];
  let b = positions[edge.y];
  let sa = screen(a.xy);
  let sb = screen(b.xy);
  let d = sb - sa;
  let len = length(d);
  let n = vec2f(-d.y, d.x) / max(len, 0.00001);
  let corners = array<vec2f, 4>(vec2f(0, -0.5), vec2f(0, 0.5), vec2f(1, -0.5), vec2f(1, 0.5));
  let corner = corners[v];
  // The same device-pixel width and opacity ramp as the blended straight-link study.
  let width = params.state.y * params.viewport.z;
  let ramp = 1.0;
  let quadWidth = max(width, ramp) + ramp;
  var out: SmoothLinkVertex;
  out.position = clip(mix(sa, sb, corner.x) + n * corner.y * quadWidth);
  out.across = corner.y;
  out.color = vec4f(linkRgb(i), linkOpacity(b.xy - a.xy) * min(width / ramp, 1.0));
  out.smoothing = ramp / quadWidth;
  out.id = i + 1u;
  if (a.w > 0.5 || b.w > 0.5 || len <= 0.00001 || width <= 0.0 || params.linkColor.a <= 0.0) {
    out.position = vec4f(2, 2, 2, 1);
  }
  return out;
}

fn smoothLinkAlpha(v: SmoothLinkVertex) -> f32 {
  return v.color.a * (1.0 - smoothstep(0.5 - v.smoothing, 0.5, abs(v.across)));
}

@fragment fn smoothLinkColor(v: SmoothLinkVertex) -> @location(0) vec4f {
  return vec4f(v.color.rgb, smoothLinkAlpha(v));
}

@fragment fn smoothLinkId(v: SmoothLinkVertex) -> @location(0) vec4f {
  if (smoothLinkAlpha(v) < 0.5 / 255.0) { discard; }
  return encodedId(v.id, 0.5);
}
