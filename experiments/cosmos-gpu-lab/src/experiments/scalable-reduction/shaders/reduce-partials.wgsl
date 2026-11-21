struct Parameters {
  count: u32,
  _padding0: u32,
  _padding1: u32,
  _padding2: u32,
}

@group(0) @binding(0) var<storage, read> inputValues: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outputValues: array<vec4f>;
@group(0) @binding(2) var<uniform> parameters: Parameters;
var<workgroup> sharedValues: array<vec4f, 256>;

@compute @workgroup_size(256)
fn main(
  @builtin(global_invocation_id) globalId: vec3u,
  @builtin(local_invocation_id) localId: vec3u,
  @builtin(workgroup_id) workgroupId: vec3u,
) {
  var value = vec4f(0.0);
  if (globalId.x < parameters.count) {
    value = inputValues[globalId.x];
  }
  sharedValues[localId.x] = value;
  workgroupBarrier();

  var stride = 128u;
  loop {
    if (localId.x < stride) {
      sharedValues[localId.x] += sharedValues[localId.x + stride];
    }
    workgroupBarrier();
    if (stride == 1u) {
      break;
    }
    stride /= 2u;
  }

  if (localId.x == 0u) {
    outputValues[workgroupId.x] = sharedValues[0];
  }
}
