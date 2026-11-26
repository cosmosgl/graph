// The standalone pointer uses circle sprites in a lower-resolution buffer, regardless of point shape or paint.
struct PickSprite {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) index: u32,
  @location(1) local: vec2f,
}

@vertex fn pointerPointVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> PickSprite {
  var out: PickSprite;
  out.position = vec4f(2,2,2,1);
  let i = pointOrder[instance];
  let live = positions[i];
  if (live.w > 0.5) { return out; }
  // Use the size from the displayed frame, including the frozen source after
  // an interruption. A live slot keeps its pick footprint during a presence fade.
  let style = currentPoint(i, 1.0);
  let size = max(style.metrics.x, style.metrics.w);
  let cssDiameter = size * params.point.x * sizeZoom(params.point.y);
  if (cssDiameter <= 0.0) { return out; }
  let normalized = (live.xy - params.pointViewport.xy) * (2.0 / params.pointViewport.zw);
  let ndc = normalized * params.pointProjection.xy + params.pointProjection.zw;
  if (any(abs(ndc) > vec2f(1))) { return out; }
  // region.xy is the window's lower-left texel; region.zw is the virtual pick-buffer size.
  let center = (ndc * 0.5 + 0.5) * params.region.zw;
  let radius = max(cssDiameter * (params.region.z / params.pointViewport.z) * 0.5, 1.0);
  let corners = array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));
  out.local = corners[vertex];
  let pixel = (center - params.region.xy) + out.local * radius;
  out.position = vec4f(pixel * (2.0 / pickWindowSize) - 1.0, 0, 1);
  out.index = i;
  return out;
}

@fragment fn pointerPointFragment(input: PickSprite) -> @location(0) vec4f {
  if (dot(input.local, input.local) > 1.0) { discard; }
  return encodedId(input.index, 1.0);
}
