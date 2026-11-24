// Each lane totals its share of the finest grid. Counts weight the measurement
// by points, so a dense cluster still matters if it occupies very few cells.
@group(0) @binding(0) var<storage, read> cells: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> totals: vec4u;
var<workgroup> partial: array<vec4u, 256>;

@compute @workgroup_size(256) fn countOccupancy(@builtin(local_invocation_index) lane: u32) {
  var sum = vec4u(0);
  for (var i = lane; i < CELL_COUNT; i += 256u) {
    let n = u32(cells[i].z);
    sum += vec4u(n, select(0u, n, n > MIN_SLOTS), select(0u, n, n > 2u * MIN_SLOTS), select(0u, n, n > 4u * MIN_SLOTS));
  }
  partial[lane] = sum;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride >>= 1u) {
    if (lane < stride) { partial[lane] += partial[lane + stride]; }
    workgroupBarrier();
  }
  if (lane == 0u) { totals = partial[0]; }
}
