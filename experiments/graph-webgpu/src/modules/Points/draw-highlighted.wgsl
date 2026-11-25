struct Ring {
  @builtin(position) position: vec4f,
  @location(0) corner: vec2f,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) color: vec4f,
}

// The reference draws hover and focus over all the point sprites. A separate
// quad keeps their draw order and leaves the sprite's sampling grid untouched.
@vertex fn pointRingVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Ring {
  var out: Ring;
  out.position = vec4f(2,2,2,1);
  let ids = vec3f(params.selected.x, params.pointRings.w, params.selected.y);
  let id = ids[instance];
  if (!(id >= 0.0 && id < params.modes.z && id == floor(id)) || (instance == 1u && id == ids.x)) { return out; }
  let i = u32(id);
  let position = positions[i];
  let presence = visualPresence(i, position.w);
  if (presence <= 0.0) { return out; }
  let p = currentPoint(i, presence);
  let factor = params.point.x * params.camera.w * sizeZoom(params.point.y);
  let footprint = min(max(p.metrics.x, p.metrics.w) * factor, params.transition.w * params.camera.w);
  if (footprint <= 0.0) { return out; }
  out.radius = max(footprint, 1.0) * 1.3 * 0.5;
  let corners = array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));
  out.corner = corners[vertex];
  out.position = clip(screen(position.xy) + out.corner * (out.radius + 1.0));

  out.color = select(params.hoverRing, params.focusRing, instance == 2u);
  out.color.a *= params.pointRings.x;
  if (p.effects.y > 0.0) {
    if (params.pointRings.z > 0.0) {
      out.color = params.greyExitColor;
    } else {
      out.color = vec4f(out.color.rgb * 0.35 + params.greyExitColor.rgb, out.color.a);
    }
    if (params.pointRings.y >= 0.0) { out.color.a *= params.pointRings.y; }
  }
  return out;
}

@fragment fn pointRingFragment(input: Ring) -> @location(0) vec4f {
  let r = length(input.corner) * (input.radius + 1.0);
  // draw-highlighted.frag defines the inner edge as a squared radius.
  let inner = sqrt(0.85) * input.radius;
  let center = (input.radius + inner) * 0.5;
  let halfCore = max(input.radius - inner, 1.0) * 0.5;
  let alpha = 1.0 - smoothstep(-0.5, 0.5, abs(r - center) - halfCore);
  return vec4f(input.color.rgb, alpha * input.color.a);
}
