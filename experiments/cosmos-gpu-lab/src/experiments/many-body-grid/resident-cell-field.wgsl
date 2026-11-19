// Prefix: ordinary source centroids. Tail: one vec4 per target cell for the
// center, or two vec4s holding four corner pushes. Both fit the same binding.
fn fieldOffset(key: u32) -> u32 {
  return u32(params.cellCount) + key * select(1u, 2u, fourCorners);
}

@compute @workgroup_size(64)
fn buildCellField(@builtin(global_invocation_id) gid: vec3u) {
  let key = gid.x;
  if (key >= levels[cachedLevels].y) { return; }
  if (centroids[key].z == 0.) { return; }
  var level = 0u;
  while (level + 1u < cachedLevels && key >= levels[level + 1u].y) { level++; }
  let n = levels[level].x;
  let localKey = key - levels[level].y;
  let cell = vec2i(i32(localKey % n), i32(localKey / n));
  let size = box.z / f32(n);
  let origin = box.xy + vec2f(cell) * size;
  let out = fieldOffset(key);
  if (fourCorners) {
    centroids[out] = vec4f(shellPush(level, n, cell, origin), shellPush(level, n, cell, origin + vec2f(size, 0.)));
    centroids[out + 1u] = vec4f(shellPush(level, n, cell, origin + vec2f(0., size)), shellPush(level, n, cell, origin + size));
  } else {
    centroids[out] = vec4f(shellPush(level, n, cell, origin + size * 0.5), 0., 0.);
  }
}

fn readCellField(point: vec2f) -> vec2f {
  var push = vec2f(0.);
  for (var level = 0u; level < cachedLevels; level++) {
    let n = levels[level].x;
    let cell = gridCell(point, n);
    let offset = fieldOffset(levels[level].y + cell.y * n + cell.x);
    let bottom = centroids[offset];
    if (fourCorners) {
      let top = centroids[offset + 1u];
      let uv = clamp((point - box.xy) * (box.w * f32(n)) - vec2f(cell), vec2f(0.), vec2f(1.));
      push += mix(mix(bottom.xy, bottom.zw, uv.x), mix(top.xy, top.zw, uv.x), uv.y);
    } else {
      push += bottom.xy;
    }
  }
  return push;
}
