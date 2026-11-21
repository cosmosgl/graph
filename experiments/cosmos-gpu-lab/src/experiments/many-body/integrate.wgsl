struct Params { count: f32, alpha: f32, repulsion: f32, nearLimit: f32, friction: f32, stepGuard: f32, pad0: f32, pad1: f32 }
@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> forces: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read_write> output: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.count)) { return; }
  let point = positions[i];
  let velocity = forces[i].xy;
  if (point.z > 0.5 || point.w > 0.5 || any((bitcast<vec2<u32>>(velocity) & vec2<u32>(0x7f800000u)) == vec2<u32>(0x7f800000u))) {
    output[i] = point; return;
  }
  let largestVelocity = max(abs(velocity.x), abs(velocity.y));
  let largest = largestVelocity * abs(params.friction);
  if (largest > 0.5 * params.stepGuard) {
    let scaled = select(velocity, velocity * 1e-30, largestVelocity > 1e30);
    let direction = scaled / max(abs(scaled.x), abs(scaled.y)) * sign(params.friction);
    let directionLength = length(direction);
    if (largest > params.stepGuard / directionLength) {
      output[i] = vec4<f32>(point.xy + direction * (params.stepGuard / directionLength), point.zw); return;
    }
  }
  output[i] = vec4<f32>(point.xy + velocity * params.friction, point.zw);
}
