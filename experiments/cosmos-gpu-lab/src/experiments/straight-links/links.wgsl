struct Link { endpoints: vec4u, color: vec4f, style: vec4f }
struct Params { view: vec4f, style: vec4f, options: vec4f }
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> links: array<Link>;
@group(0) @binding(2) var<uniform> params: Params;
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) coord: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) smoothing: f32,
  @location(3) @interpolate(flat) id: u32,
  @location(4) @interpolate(flat) ribbon: vec4f,
  @location(5) @interpolate(flat) halfWidth: f32,
}
@vertex fn vertexMain(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> Vertex {
  let corners = array<vec2f,4>(vec2f(0,0.5),vec2f(0,-0.5),vec2f(1,0.5),vec2f(1,-0.5));
  let link = links[instance]; let a = positions[link.endpoints.x]; let b = positions[link.endpoints.y];
  let delta = b.xy - a.xy; let distance = length(delta); let zoom = params.view.z; let ratio = params.view.w;
  let n = normalize(select(vec2f(-delta.y,delta.x),vec2f(1,0),distance == 0.0));
  var width = link.style.x * params.style.x;
  if (params.options.x < 0.5) { width = width / zoom * min(5.0,max(1.0,zoom * 0.01)); }
  width = min(width,params.style.y / zoom);
  if (params.options.z > 0.0 && params.options.w < 0.5) { width += 5.0 / zoom; }
  let ramp = (1.0 / ratio) / zoom;
  var thinAlpha = min(width / ramp,1.0);
  if (params.options.y < 0.5) { thinAlpha = 1.0; }
  let quadWidth = max(width,ramp) + ramp;
  let corner = corners[index]; let world = mix(a.xy,b.xy,corner.x) + n * quadWidth * corner.y;
  var result: Vertex;
  result.position = vec4f(world * (2.0 / params.view.xy) * zoom,0,1);
  if (a.z > 0.5 || b.z > 0.5 || link.style.x * params.style.x <= 0.0 || distance <= 0.0) { result.position = vec4f(2,2,2,1); }
  result.coord = corner; result.color = vec4f(link.color.rgb,link.color.a * params.style.z * thinAlpha);
  result.ribbon = vec4f(vec2f(a.x,-a.y) * zoom * ratio + params.view.xy * ratio * 0.5,vec2f(n.x,-n.y));
  result.halfWidth = max(width,ramp) * zoom * ratio * 0.5;
  result.smoothing = ramp / quadWidth; result.id = link.endpoints.z + u32(params.style.w);
  return result;
}
@fragment fn fragmentMain(input: Vertex) -> @location(0) vec4f {
  // Mirror production's descending Hermite interpolation.
  let coverage = smoothstep(0.5,0.5 - input.smoothing,abs(input.coord.y));
  let alpha = input.color.a * coverage;
  if (params.options.z > 0.0) {
    let covered = select(coverage >= 0.5,
      abs(dot(input.position.xy - input.ribbon.xy,input.ribbon.zw)) <= input.halfWidth,params.options.w > 0.5);
    if (!covered || input.color.a <= 0.0) { discard; }
    if (params.options.w > 0.5 && params.options.y > 0.5 && quantizeSourceAlpha(alpha) <= 0.0) { discard; }
    // Hard color uses this interpolated predicate; an analytic tie cannot
    // select a fragment that the original color pass discards.
    if (params.options.w > 0.5 && params.options.y < 0.5 && coverage < 0.5) { discard; }
    let id = input.id + 1u;
    return vec4f(vec3f(f32(id & 255u),f32((id >> 8u) & 255u),f32((id >> 16u) & 255u)) / 255.0,1);
  }
  if (params.options.y < 0.5) {
    if (coverage < 0.5 || alpha <= 0.0) { discard; }
    return vec4f(input.color.rgb,1);
  }
  return vec4f(input.color.rgb,alpha);
}


// Unblended float probes are separate entry points, never acceptance outputs.
@fragment fn varyingProbe(input: Vertex) -> @location(0) vec4f {
  let coverage = smoothstep(0.5,0.5 - input.smoothing,abs(input.coord.y));
  return vec4f(input.coord.y,input.smoothing,coverage,f32(input.id + 1u));
}
@fragment fn pixelProbe(input: Vertex) -> @location(0) vec4f {
  let distancePx = abs(dot(input.position.xy - input.ribbon.xy,input.ribbon.zw));
  let coverage = smoothstep(input.halfWidth + 0.5,input.halfWidth - 0.5,distancePx);
  return vec4f(distancePx,input.halfWidth,coverage,f32(input.id + 1u));
}
