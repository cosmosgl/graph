// Physical-pixel transforms are shared by color passes and a 1×1 pick pass.
struct Params {
  camera: vec4f,           // CSS translation, scale, DPR
  region: vec4f,           // top-left and size of the target in backing pixels
  point: vec4f,            // size scale, scale on zoom, point pick alpha, link pick offset
  link: vec4f,             // width scale, scale on zoom, global opacity, blend
  curve: vec4f,            // segments, weight, control distance, pick width padding (CSS)
  visibility: vec4f,       // near/far distances, minimum alpha, gradient enabled
  selected: vec4f,         // hovered point, focused point, hovered link, focused link
  widths: vec4f,           // hovered/focused link increase, dash length/gap
  modes: vec4f,            // picking, arrow scale, point count, link picking alpha
  hoverColor: vec4f,       // negative alpha when the visible link color is retained
  hoverRing: vec4f,
  focusRing: vec4f,
  transition: vec4f,       // eased progress, source point count, source link count, max size (CSS)
  shades: vec4f,           // stroke direction, stroke contrast, ring direction, ring contrast
  pointViewport: vec4f,    // world origin and full CSS viewport, including during 1×1 picking
  pointProjection: vec4f,  // x/y clip-space scales and translations from Zoom
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec4f>;
@group(0) @binding(2) var<storage, read> points: array<Point>;
@group(0) @binding(3) var<storage, read> links: array<Link>;
@group(0) @binding(4) var<storage, read> pointOrder: array<u32>;
@group(0) @binding(5) var atlas: texture_2d<f32>;
@group(0) @binding(6) var atlasSampler: sampler;
@group(0) @binding(7) var<storage, read> previousPoints: array<Point>;
@group(0) @binding(8) var<storage, read> previousLinks: array<Link>;

fn currentPoint(i: u32) -> Point {
  let next = points[i];
  if (params.transition.x >= 1.0) { return next; }
  if (i >= u32(params.transition.y)) { return enterPoint(next,params.transition.x); }
  return interpolatePoint(previousPoints[i],next,params.transition.x);
}

fn currentLink(i: u32) -> Link {
  let next = links[i];
  if (params.transition.x >= 1.0) { return next; }
  if (i >= u32(params.transition.z)) { return enterLink(next,params.transition.x); }
  return interpolateLink(previousLinks[i],next,params.transition.x);
}

fn screen(world: vec2f) -> vec2f {
  return (world * vec2f(params.camera.z, -params.camera.z) + params.camera.xy) * params.camera.w;
}

fn clip(pixel: vec2f) -> vec4f {
  let uv = (pixel - params.region.xy) / params.region.zw;
  return vec4f(uv * vec2f(2,-2) + vec2f(-1,1), 0, 1);
}

fn sizeZoom(scalesWithZoom: f32) -> f32 {
  return select(clamp(params.camera.z * 0.01, 1.0, 5.0), params.camera.z, scalesWithZoom > 0.0);
}

fn encodedId(index: u32, alpha: f32) -> vec4f {
  let id = index + 1u;
  return vec4f(f32(id & 255u) / 255.0, f32((id >> 8u) & 255u) / 255.0,
               f32((id >> 16u) & 255u) / 255.0, alpha);
}
