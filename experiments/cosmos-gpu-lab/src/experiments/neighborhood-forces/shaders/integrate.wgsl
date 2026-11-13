struct Parameters {
  count: u32,
  gridSize: u32,
  radius: f32,
  strength: f32,
  dt: f32,
  damping: f32,
  padding: vec2f,
}
@group(0) @binding(0) var<storage, read> positions: array<vec2f>;
@group(0) @binding(1) var<storage, read> velocities: array<vec2f>;
@group(0) @binding(2) var<storage, read> forces: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> nextPositions: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> nextVelocities: array<vec2f>;
@group(0) @binding(5) var<uniform> params: Parameters;

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) global: vec3u) {
  let i = global.x;
  if (i >= params.count) { return; }
  let force = forces[i].xy;
  let acceleration = force * min(1.0, 10.0 / max(length(force), 0.000001));
  var velocity = (velocities[i] + acceleration * params.dt) * params.damping;
  velocity *= min(1.0, 0.5 / max(length(velocity), 0.000001));
  var position = positions[i] + velocity * params.dt;
  for (var axis = 0u; axis < 2u; axis++) {
    if (position[axis] < -1.0 || position[axis] > 1.0) {
      position[axis] = clamp(position[axis], -1.0, 1.0);
      velocity[axis] *= -0.5;
    }
  }
  nextPositions[i] = position;
  nextVelocities[i] = velocity;
}
