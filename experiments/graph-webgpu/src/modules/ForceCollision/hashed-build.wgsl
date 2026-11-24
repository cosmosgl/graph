@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<uniform> grid: CollisionGrid;
@group(0) @binding(2) var<storage, read_write> heads: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> next: array<u32>;
@group(0) @binding(4) var<storage, read_write> slots: array<u32>;

@compute @workgroup_size(64)
fn clearHeads(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < arrayLength(&heads)) { atomicStore(&heads[id.x], 0u); }
}

@compute @workgroup_size(64)
fn linkPoints(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= grid.count) { return; }
  let point = positions[id.x];
  if (point.w > 0.5) { return; }
  let bucket = collisionSlotBucket(collisionWorldCell(point.xy));
  // Store index + 1 so zero can terminate the list. Dispatch order separates
  // all head and link writes from selection.
  next[id.x] = atomicExchange(&heads[bucket], id.x + 1u);
}

@compute @workgroup_size(64)
fn selectSlots(@builtin(global_invocation_id) id: vec3u) {
  let bucket = id.x;
  if (bucket >= grid.edge * grid.edge) { return; }
  writeCellSlots(bucket, atomicLoad(&heads[bucket]), grid.capacity, grid.seedBits);
}
