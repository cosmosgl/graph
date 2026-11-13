struct Parameters {
  count: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32,
}

@group(0) @binding(0) var<storage, read> inputValues: array<u32>;
@group(0) @binding(1) var<storage, read_write> outputOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(3) var<uniform> parameters: Parameters;

var<workgroup> scratch: array<u32, 256>;

@compute @workgroup_size(256)
fn main(
  @builtin(global_invocation_id) globalId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) workgroupId: vec3<u32>,
) {
  let index = globalId.x;
  let lane = localId.x;
  scratch[lane] = select(0u, inputValues[index], index < parameters.count);
  workgroupBarrier();

  var stride = 1u;
  while (stride < 256u) {
    var addend = 0u;
    if (lane >= stride) {
      addend = scratch[lane - stride];
    }
    workgroupBarrier();
    if (lane >= stride) {
      scratch[lane] = scratch[lane] + addend;
    }
    workgroupBarrier();
    stride = stride * 2u;
  }

  if (index < parameters.count) {
    if (lane == 0u) {
      outputOffsets[index] = 0u;
    } else {
      outputOffsets[index] = scratch[lane - 1u];
    }
  }
  if (lane == 255u) {
    blockSums[workgroupId.x] = scratch[255u];
  }
}
