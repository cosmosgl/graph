struct Edge { other: u32, bias: f32, strength: f32, random: f32 }
struct Params { spring: f32, distance: f32, low: f32, high: f32, alpha: f32, friction: f32, maxStep: f32, collision: f32, radius: f32, padding: f32, count: f32, unused: f32 }
@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> offsets: array<u32>;
@group(0) @binding(2) var<storage, read> edges: array<Edge>;
@group(0) @binding(3) var<storage, read> sizes: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read_write> forces: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.count)) { return; }
  let point = positions[i];
  var velocity = vec2<f32>(0.0);
  for (var e = offsets[i]; e < offsets[i + 1u]; e++) {
    let edge = edges[e];
    let other = positions[edge.other];
    if (other.w > 0.5) { continue; }
    var rest = (edge.random * (params.high - params.low) + params.low) * params.distance;
    if (params.collision > 0.5) {
      let selfRadius = select(sizes[i] * 0.5, params.radius, params.radius > 0.0) + params.padding;
      let otherRadius = select(sizes[edge.other] * 0.5, params.radius, params.radius > 0.0) + params.padding;
      rest = max(rest, selfRadius + otherRadius);
    }
    let delta = other.xy - (point.xy + velocity);
    var length = max(sqrt(delta.x * delta.x + delta.y * delta.y), rest * 0.99);
    length = (length - rest) / length;
    length *= params.spring * params.alpha;
    length *= edge.strength;
    length *= edge.bias;
    velocity += delta * length;
  }
  forces[i] = vec4<f32>(velocity, 0.0, 0.0);
}
