// Both grid forces use the WebGL depth-peeling order. The hash is stored
// as an f32 in the reference, so equal hash values select one point only.
fn cellSlotHash(index: u32, seedBits: u32) -> f32 {
  var h = index ^ seedBits;
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  h ^= h >> 16u;
  let normalized = (f32(h >> 8u) + 0.5) / 16777216.0;
  return 0.001 + roundedProduct(normalized, 0.998);
}

// Read one linked list, retaining the smallest K distinct hashes in order.
// Lists and slots store index + 1; the first zero ends either sequence.
fn writeCellSlots(bucket: u32, first: u32, capacity: u32, seedBits: u32) {
  let base = bucket * capacity;
  if (first == 0u) { slots[base] = 0u; return; }
  if (next[first - 1u] == 0u) {
    slots[base] = first;
    if (capacity > 1u) { slots[base + 1u] = 0u; }
    return;
  }

  var selected: array<u32, maxCellSlots>;
  var hashes: array<f32, maxCellSlots>;
  var filled = 0u;
  var entry = first;
  while (entry != 0u) {
    let index = entry - 1u;
    let hash = cellSlotHash(index, seedBits);
    var place = filled;
    while (place > 0u && hashes[place - 1u] > hash) { place--; }
    if (place > 0u && hashes[place - 1u] == hash) {
      // Depth ties retain the first source index, regardless of atomic list order.
      selected[place - 1u] = min(selected[place - 1u], entry);
    } else if (place < capacity) {
      for (var i = min(filled, capacity - 1u); i > place; i--) {
        hashes[i] = hashes[i - 1u];
        selected[i] = selected[i - 1u];
      }
      hashes[place] = hash;
      selected[place] = entry;
      filled = min(filled + 1u, capacity);
    }
    entry = next[index];
  }
  for (var slot = 0u; slot < filled; slot++) { slots[base + slot] = selected[slot]; }
  if (filled < capacity) { slots[base + filled] = 0u; }
}
