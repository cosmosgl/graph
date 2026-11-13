struct Point { geometry: vec4f, color: vec4f, strokeColor: vec4f, properties: vec4f }
struct Params { view: vec4f, style: vec4f, options: vec4f }
@group(0) @binding(0) var<storage, read> points: array<Point>;
@group(0) @binding(1) var<uniform> params: Params;
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) coord: vec2f,
  @location(1) @interpolate(flat) index: u32,
  @location(2) @interpolate(flat) diameter: f32,
  @location(3) @interpolate(flat) center: vec2f,
}
fn inradius(shape: u32) -> f32 {
  switch shape {
    case 1u: { return 0.8; } case 2u: { return 0.9 / sqrt(3.0); }
    case 3u: { return 0.8 * 1.2 / sqrt(1.2 * 1.2 + 1.0); }
    case 4u: { return 0.726542528; } case 5u: { return 0.8; }
    case 6u: { return 0.9 * 0.45; } case 7u: { return 0.3; } default: { return 1.0; }
  }
}
// Production signed-distance geometry, expressed in WGSL. coord has the same
// top-to-bottom y direction as gl_PointCoord; world-space y remains upward in GLSL.
fn distanceToShape(coord: vec2f, shape: u32) -> f32 {
  var p = coord;
  switch shape {
    case 1u: {
      let d = abs(p) - vec2f(0.8);
      return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
    }
    case 2u: {
      let k = sqrt(3.0); let r = 0.9;
      p.x = abs(p.x) - r; p.y += 0.55;
      if (p.x + k * p.y > 0.0) { p = vec2f(p.x - k * p.y, -k * p.x - p.y) / 2.0; }
      p.x -= clamp(p.x, -2.0 * r, 0.0);
      return -length(p) * sign(p.y);
    }
    case 3u: {
      let b = vec2f(0.8, 0.8 * 1.2); p = abs(p);
      let h = clamp(((b.x - 2.0 * p.x) * b.x - (b.y - 2.0 * p.y) * b.y) / dot(b,b), -1.0, 1.0);
      return length(p - 0.5 * b * vec2f(1.0 - h, 1.0 + h)) * sign(p.x * b.y + p.y * b.x - b.x * b.y);
    }
    case 4u: {
      let k = vec3f(0.809016994, 0.587785252, 0.726542528); let r = 0.726542528;
      p.x = abs(p.x);
      p -= 2.0 * min(dot(vec2f(-k.x, k.y), p), 0.0) * vec2f(-k.x, k.y);
      p -= 2.0 * min(dot(vec2f(k.x, k.y), p), 0.0) * vec2f(k.x, k.y);
      p -= vec2f(clamp(p.x, -r * k.z, r * k.z), r);
      return length(p) * sign(p.y);
    }
    case 5u: {
      let k = vec3f(-0.866025404, 0.5, 0.577350269); p = abs(p);
      p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
      p -= vec2f(clamp(p.x, -k.z * 0.8, k.z * 0.8), 0.8);
      return length(p) * sign(p.y);
    }
    case 6u: {
      let k1 = vec2f(0.809016994, -0.587785252); let k2 = vec2f(-k1.x, k1.y);
      p.x = abs(p.x);
      p -= 2.0 * max(dot(k1,p), 0.0) * k1;
      p -= 2.0 * max(dot(k2,p), 0.0) * k2;
      p.x = abs(p.x); p.y -= 0.9;
      let ba = 0.45 * vec2f(-k1.y, k1.x) - vec2f(0.0,1.0);
      let h = clamp(dot(p,ba) / dot(ba,ba), 0.0, 0.9);
      return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
    }
    case 7u: {
      p = abs(p); if (p.y > p.x) { p = p.yx; }
      let q = p - vec2f(0.8,0.3);
      return length(max(q,vec2f(0.0))) + min(max(q.x,q.y),0.0);
    }
    default: { return length(p) - 1.0; }
  }
}
@vertex fn vertexMain(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Vertex {
  let corners = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let p = points[index]; let ratio = params.view.z; let zoom = params.view.w;
  let sizeZoom = select(min(5.0,max(1.0,zoom * 0.01)), zoom, params.options.x > 0.0);
  let diameter = min(p.geometry.z * params.style.x * ratio * sizeZoom, params.style.y * ratio);
  let sprite = max(diameter,1.0);
  let center = (params.view.xy * 0.5 + (p.geometry.xy - params.view.xy * 0.5) * zoom) * ratio;
  // Expand only the carrier quad; the fragment clips to the original sprite.
  // GL points include the bottom edge, whereas WebGPU triangles include the top.
  // Explicit bounds preserve point rasterization at exact half-pixel ties.
  let pixel = center + corners[vertex] * (sprite + 2.0) * 0.5;
  var result: Vertex;
  result.position = vec4f(pixel.x / (params.view.x * ratio) * 2.0 - 1.0, 1.0 - pixel.y / (params.view.y * ratio) * 2.0, 0, 1);
  if (diameter <= 0.0 || p.properties.y > 0.0 || p.geometry.w == 8.0 || p.color.a == 0.0) { result.position = vec4f(3,3,0,1); }
  result.coord = corners[vertex]; result.index = index; result.diameter = diameter; result.center = center;
  return result;
}
@fragment fn fragmentMain(input: Vertex) -> @location(0) vec4f {
  let p = points[input.index]; let shape = u32(p.geometry.w); let core = max(input.diameter,1.0);
  let offset = input.position.xy - input.center;
  if (params.options.z > 0.0) {
    // Closed bounds match the unchanged scalar mask. The padded carrier reaches
    // all four exact boundary pixels without increasing the shape diameter.
    if (abs(offset.x) > core * 0.5 || abs(offset.y) > core * 0.5) { discard; }
  } else {
    if (offset.x < -core * 0.5 || offset.x >= core * 0.5 || offset.y <= -core * 0.5 || offset.y > core * 0.5) { discard; }
  }
  let coord = offset * (2.0 / core);
  let distance = distanceToShape(coord,shape) * core * 0.5;
  let coverage = 1.0 - smoothstep(-0.5,0.5,distance);
  // Unblended float-target instrumentation; normal color/ID modes are unchanged.
  if (params.options.y == 2.0) { return vec4f(coord,core,input.diameter); }
  if (params.options.y == 3.0) { return vec4f(coord,distance,coverage); }
  let smallAlpha = min(1.0,input.diameter * input.diameter / (core * core));
  var sourceAlpha = coverage * smallAlpha * p.color.a * params.style.z;
  if (params.options.w > 0.0) {
    // Same grouping as the GLSL candidate's finalShapeColor.a * pointOpacity.
    sourceAlpha = quantizeSourceAlpha(coverage * (smallAlpha * p.color.a) * params.style.z);
  }
  // Keep the production rule when options.z is zero. The candidate additionally
  // rejects invisible points; positive opacity preserves the same pick contour.
  if (params.options.y > 0.0) {
    if (params.options.z > 0.0 && params.style.z <= 0.0) { discard; }
    if (params.options.w > 0.0 && sourceAlpha <= 0.0) { discard; }
    if (coverage < 0.5) { discard; }
    let id = u32(p.properties.z) + 1u;
    return vec4f(vec3f(f32(id & 255u),f32((id >> 8u) & 255u),f32((id >> 16u) & 255u)) / 255.0,1);
  }
  let strokeWidth = min(max(p.properties.x,0.0) * params.view.z,input.diameter * 0.5 * inradius(shape) * 0.5);
  let bandDistance = abs(distance + strokeWidth * 0.5) - strokeWidth * 0.5;
  let stroke = select(0.0,1.0 - smoothstep(-0.5,0.5,bandDistance),strokeWidth > 0.0);
  let color = mix(p.color.rgb,p.strokeColor.rgb,stroke * p.strokeColor.a);
  return vec4f(color,sourceAlpha);
}
