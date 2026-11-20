struct Partial { x: vec2f, y: vec2f, count: u32, padding: array<u32, 3> }
@group(0) @binding(0) var<storage, read> points: array<vec4f>;
@group(0) @binding(1) var<storage, read> members: array<u32>;
@group(0) @binding(2) var<storage, read> ranges: array<vec4u>;
@group(0) @binding(3) var<storage, read> previous: array<Partial>;
@group(0) @binding(4) var<storage, read_write> partials: array<Partial>;
@group(0) @binding(5) var<storage, read_write> aggregates: array<vec4f>;
var<workgroup> scratch: array<Partial, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) local: vec3u, @builtin(workgroup_id) group: vec3u) {
  let range = ranges[group.x]; var value: Partial;
  if (local.x < range.y) {
    // SOURCE_POINTS is replaced at shader construction, not a runtime branch.
    if (SOURCE_POINTS) {
      let point = points[members[range.x + local.x]];
      if (point.w <= 0.5) { value.x = vec2f(point.x, 0.); value.y = vec2f(point.y, 0.); value.count = 1u; }
    } else {
      // A large group can span more partials than the workgroup has lanes.
      value = previous[range.x + local.x];
      for (var offset = local.x + 256u; offset < range.y; offset += 256u) {
        let partial = previous[range.x + offset];
        value.x = sum_fp64(value.x, partial.x);
        value.y = sum_fp64(value.y, partial.y);
        value.count += partial.count;
      }
    }
  }
  scratch[local.x] = value; workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) {
    if (local.x < stride) {
      scratch[local.x].x = sum_fp64(scratch[local.x].x, scratch[local.x + stride].x);
      scratch[local.x].y = sum_fp64(scratch[local.x].y, scratch[local.x + stride].y);
      scratch[local.x].count += scratch[local.x + stride].count;
    }
    workgroupBarrier();
  }
  if (local.x == 0u) {
    if (SOURCE_POINTS) { partials[group.x] = scratch[0]; }
    else { aggregates[group.x] = vec4f(scratch[0].x.x, scratch[0].y.x, f32(scratch[0].count), 0.); }
  }
}
