@group(0) @binding(0) var<storage, read_write> links: array<Link>;
@group(0) @binding(1) var<storage, read> widths: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = invocation.x + invocation.y * groups.x * 64u;
  if (i < arrayLength(&widths)) { links[i].geometry.z = widths[i]; }
}
