@group(0) @binding(0) var<storage, read_write> counts: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < arrayLength(&counts)) { counts[id.x] = 0u; }
}
