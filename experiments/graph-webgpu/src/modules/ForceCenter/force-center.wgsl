@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@group(0) @binding(2) var<uniform> params: vec4f;
@group(0) @binding(3) var<storage, read> centroid: array<vec4f>;

@compute @workgroup_size(64) fn center(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&positions)) { return; }
  let c = centroid[0];
  output[id.x] = vec4f((c.xy / max(c.z, 1.) - positions[id.x].xy) * (params.z * params.w * 0.01), 0., 0.);
}
