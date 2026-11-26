@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@group(0) @binding(4) var<storage, read> ids: array<u32>;

@compute @workgroup_size(64) fn gather(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let index = id.x + id.y * groups.x * 64u;
  if (index >= arrayLength(&output)) { return; }
  let i = ids[index];
  if (i >= arrayLength(&positions)) { output[index] = vec4f(0.,0.,0.,1.); return; }
  output[index] = positions[i];
}
