// Keep the residual through every level; round to the existing vec4 only once.
struct Partial {
  x: vec2f,
  y: vec2f,
  count: u32,
  padding: array<u32, 3>,
}
struct Params { count: u32, points: u32, finalStage: u32, padding: u32 }
@group(0) @binding(0) var<storage, read> points: array<vec4f>;
@group(0) @binding(1) var<storage, read> partials: array<Partial>;
@group(0) @binding(2) var<storage, read_write> output: array<Partial>;
@group(0) @binding(3) var<storage, read_write> result: array<vec4f>;
@group(0) @binding(4) var<uniform> params: Params;
var<workgroup> scratch: array<Partial, 256>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u,
        @builtin(local_invocation_id) local: vec3u,
        @builtin(workgroup_id) group: vec3u) {
  var value: Partial;
  if (id.x < params.count) {
    if (params.points != 0u) {
      // Absent XY may be NaN. Never feed it to the arithmetic helpers.
      if (points[id.x].w <= 0.5) {
        value.x = vec2f(points[id.x].x, 0.);
        value.y = vec2f(points[id.x].y, 0.);
        value.count = 1u;
      }
    } else { value = partials[id.x]; }
  }
  scratch[local.x] = value;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) {
    if (local.x < stride) {
      scratch[local.x].x = sum_fp64(scratch[local.x].x, scratch[local.x + stride].x);
      scratch[local.x].y = sum_fp64(scratch[local.x].y, scratch[local.x + stride].y);
      scratch[local.x].count += scratch[local.x + stride].count;
    }
    workgroupBarrier();
  }
  if (local.x == 0u) {
    if (params.finalStage != 0u) {
      result[0] = vec4f(scratch[0].x.x, scratch[0].y.x, f32(scratch[0].count), 0.);
    } else { output[group.x] = scratch[0]; }
  }
}
