@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@group(0) @binding(4) var<storage, read> ids: array<u32>;

@compute @workgroup_size(64) fn gather(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&output)) { return; }
  let i = ids[id.x];
  if (i >= arrayLength(&positions)) { output[id.x] = vec4f(0.,0.,0.,1.); return; }
  output[id.x] = positions[i];
}
