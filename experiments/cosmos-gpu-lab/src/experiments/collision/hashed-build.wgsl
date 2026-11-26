@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<uniform> grid: CollisionGrid;
@group(0) @binding(2) var<storage, read_write> heads: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> next: array<u32>;
@group(0) @binding(4) var<storage, read_write> slots: array<u32>;

fn collisionSlotHash(index: u32) -> f32 {
  var hash = index ^ grid.seedBits;
  hash = (hash ^ (hash >> 16u)) * 0x7feb352du;
  hash = (hash ^ (hash >> 15u)) * 0x846ca68bu;
  hash ^= hash >> 16u;
  let normalized = (f32(hash >> 8u) + 0.5) / 16777216.0;
  return 0.001 + roundedProduct(normalized, 0.998);
}

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
  var selected: array<u32, 32>;
  var hashes: array<f32, 32>;
  var filled = 0u;
  var entry = atomicLoad(&heads[bucket]);
  while (entry != 0u) {
    let index = entry - 1u;
    let hash = collisionSlotHash(index);
    var place = filled;
    while (place > 0u && hashes[place - 1u] > hash) { place--; }
    if (place > 0u && hashes[place - 1u] == hash) {
      // Each peeled hash has one representative. Resolve a tie independently
      // of the atomic insertion order.
      selected[place - 1u] = min(selected[place - 1u], entry);
    } else if (place < grid.capacity) {
      for (var i = min(filled, grid.capacity - 1u); i > place; i--) {
        hashes[i] = hashes[i - 1u];
        selected[i] = selected[i - 1u];
      }
      hashes[place] = hash;
      selected[place] = entry;
      filled = min(filled + 1u, grid.capacity);
    }
    entry = next[index];
  }
  let base = bucket * grid.capacity;
  for (var slot = 0u; slot < grid.capacity; slot++) { slots[base + slot] = selected[slot]; }
}
