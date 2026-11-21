struct CollisionGrid {
  count: u32,
  edge: u32,
  capacity: u32,
  rotationSeed: u32,
  origin: vec2f,
  cellsPerUnit: f32,
  seedBits: u32,
}
// @collision-rotations

fn collisionWorldCell(position: vec2f) -> vec2i {
  let relative = position - grid.origin;
  let cell = floor(vec2f(roundedProduct(relative.x, grid.cellsPerUnit), roundedProduct(relative.y, grid.cellsPerUnit)));
  return vec2i(clamp(cell, vec2f(-16777216.0), vec2f(16777216.0)));
}

fn collisionSlotRotation(block: i32, coefficients: vec2u, mask: u32) -> i32 {
  let k = bitcast<u32>(block);
  return i32((coefficients.x * k * k + (coefficients.y + grid.rotationSeed) * k) & mask);
}

fn collisionSlotBucket(cell: vec2i) -> u32 {
  let mask = grid.edge - 1u;
  let block = cell >> vec2u(firstTrailingBit(grid.edge));
  let rotation = vec2i(collisionSlotRotation(block.y, rotationX, mask), collisionSlotRotation(block.x, rotationY, mask));
  let wrapped = vec2u((cell + rotation) & vec2i(i32(mask)));
  return wrapped.y * grid.edge + wrapped.x;
}
