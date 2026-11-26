struct Link { endpoints: vec4u, color: vec4f, style: vec4f }
struct Params { view: vec4f, style: vec4f, options: vec4f, curve: vec4f }
@group(0) @binding(0) var<storage,read> positions: array<vec4f>;
@group(0) @binding(1) var<storage,read> links: array<Link>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage,read> nodes: array<vec2f>;
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) coord: vec2f,
  @location(1) color: vec4f,
  @location(2) smoothing: f32,
  @location(3) @interpolate(flat) id: u32,
}
fn conic(a: vec2f,b: vec2f,c: vec2f,t: f32,w: f32) -> vec2f {
  let u = 1.0 - t;
  return (u * u * a + 2.0 * u * t * w * c + t * t * b) / (u * u + 2.0 * u * t * w + t * t);
}
@vertex fn vertexMain(@builtin(vertex_index) index: u32,@builtin(instance_index) instance: u32) -> Vertex {
  let link = links[instance]; let a = positions[link.endpoints.x]; let b = positions[link.endpoints.y];
  let delta = b.xy - a.xy; let distance = length(delta); let zoom = params.view.z; let ratio = params.view.w;
  var result: Vertex;
  if (a.z > 0.5 || b.z > 0.5 || link.style.x * params.style.x <= 0.0 || distance == 0.0) {
    result.position = vec4f(2,2,2,1); return result;
  }
  let normal = normalize(vec2f(-delta.y,delta.x));
  let control = (a.xy + b.xy) / 2.0 + normal * distance * params.curve.z;
  var width = link.style.x * params.style.x;
  if (params.options.x < 0.5) { width = width / zoom * min(5.0,max(1.0,zoom * 0.01)); }
  width = min(width,params.style.y / zoom);
  if (params.options.z > 0.0 && params.options.w < 0.5) { width += 5.0 / zoom; }
  let ramp = (1.0 / ratio) / zoom; var thinAlpha = min(width / ramp,1.0);
  if (params.options.y < 0.5) { thinAlpha = 1.0; }
  let carrier = max(width,ramp) + ramp; let corner = nodes[index]; let t = corner.x;
  let current = conic(a.xy,b.xy,control,t,params.curve.y);
  let prev = conic(a.xy,b.xy,control,max(0.0,t - 1.0 / params.curve.x),params.curve.y);
  let next = conic(a.xy,b.xy,control,min(1.0,t + 1.0 / params.curve.x),params.curve.y);
  let tangent = next - prev; let curveNormal = normalize(vec2f(-tangent.y,tangent.x));
  let world = current + curveNormal * carrier * corner.y;
  result.position = vec4f(world * (2.0 / params.view.xy) * zoom,0,1);
  result.coord = corner; result.color = vec4f(link.color.rgb,link.color.a * params.style.z * thinAlpha);
  result.smoothing = ramp / carrier; result.id = link.endpoints.z + u32(params.style.w);
  return result;
}
@fragment fn fragmentMain(input: Vertex) -> @location(0) vec4f {
  let coverage = smoothstep(0.5,0.5 - input.smoothing,abs(input.coord.y));
  let alpha = input.color.a * coverage;
  if (params.options.z > 0.0) {
    if (coverage < 0.5 || input.color.a <= 0.0) { discard; }
    if (params.options.w > 0.5 && params.options.y > 0.5 && quantizeSourceAlpha(alpha) <= 0.0) { discard; }
    let id = input.id + 1u;
    return vec4f(vec3f(f32(id & 255u),f32((id >> 8u) & 255u),f32((id >> 16u) & 255u)) / 255.0,1);
  }
  if (params.options.y < 0.5) {
    if (coverage < 0.5 || alpha <= 0.0) { discard; }
    return vec4f(input.color.rgb,1);
  }
  return vec4f(input.color.rgb,alpha);
}
