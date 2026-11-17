struct Params { camera: vec4f, viewport: vec4f, region: vec4f, state: vec4f, linkColor: vec4f }
struct Style { color: vec4f, size: vec4f }
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> styles: array<Style>;
@group(0) @binding(2) var<storage, read> links: array<vec2u>;
@group(0) @binding(3) var<uniform> params: Params;
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) center: vec2f,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) color: vec4f,
  @location(3) @interpolate(flat) id: u32,
}
fn screen(p: vec2f) -> vec2f { return (p - params.camera.xy) * vec2f(1,-1) * params.camera.z + params.viewport.xy * 0.5; }
fn clip(p: vec2f) -> vec4f { return vec4f((p - params.region.xy) / params.region.zw * vec2f(2,-2) + vec2f(-1,1),0,1); }
@vertex fn pointVertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Vertex {
  let corners = array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));
  let p = positions[i]; let style = styles[i];
  var out: Vertex; out.center = screen(p.xy); out.radius = style.size.x * params.viewport.z * 0.5;
  out.color = style.color; out.id = i + 1u;
  if (f32(i) == params.state.x) { out.color = vec4f(0.957,0.847,0.537,style.color.a); out.radius += params.viewport.z; }
  out.position = clip(out.center + corners[v] * (out.radius + 0.5));
  if (p.w > 0.5 || style.size.x <= 0.0 || style.color.a <= 0.0) { out.position = vec4f(2,2,2,1); }
  return out;
}
fn coverage(v: Vertex) -> f32 { return 1.0 - smoothstep(v.radius - 0.5,v.radius + 0.5,length(v.position.xy + params.region.xy - v.center)); }
@fragment fn pointColor(v: Vertex) -> @location(0) vec4f { return vec4f(v.color.rgb,v.color.a * coverage(v)); }
@fragment fn pointId(v: Vertex) -> @location(0) vec4f {
  if (coverage(v) < 0.5 || v.color.a <= 0.0) { discard; }
  return vec4f(vec3f(f32(v.id & 255u),f32((v.id >> 8u) & 255u),f32((v.id >> 16u) & 255u)) / 255.0,1);
}
@vertex fn linkVertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Vertex {
  let edge = links[i]; let a = positions[edge.x]; let b = positions[edge.y];
  let sa = screen(a.xy); let sb = screen(b.xy); let d = sb - sa; let len = length(d);
  let n = vec2f(-d.y,d.x) / max(len,0.00001);
  let corners = array<vec2f,4>(vec2f(0,-1),vec2f(0,1),vec2f(1,-1),vec2f(1,1));
  let c = corners[v]; var out: Vertex;
  out.position = clip(mix(sa,sb,c.x) + n * c.y * params.state.y * 0.5 * params.viewport.z);
  out.color = params.linkColor;
  if (a.w > 0.5 || b.w > 0.5 || len <= 0.00001 || params.state.y <= 0.0 || params.linkColor.a <= 0.0) { out.position = vec4f(2,2,2,1); }
  return out;
}
@fragment fn linkColor(v: Vertex) -> @location(0) vec4f { return v.color; }
