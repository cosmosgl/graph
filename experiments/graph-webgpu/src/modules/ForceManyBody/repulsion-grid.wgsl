struct GridSettings {
  count: u32, width: u32, wideShell: u32, quantization: u32,
  alpha: f32, strength: f32, shift: vec2f,
}
struct LeafSums { x: atomic<u32>, y: atomic<u32>, count: atomic<u32> }
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> bounds: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> box: vec4f;
@group(0) @binding(3) var<uniform> settings: GridSettings;
@group(0) @binding(4) var<storage, read_write> heads: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> next: array<u32>;
@group(0) @binding(6) var<storage, read_write> sums: array<LeafSums>;
@group(0) @binding(7) var<storage, read_write> cells: array<vec4f>;
@group(0) @binding(8) var<uniform> level: vec4u;
@group(0) @binding(9) var<storage, read_write> forces: array<vec4f>;

// Same square, minimum finest-cell size, one coarse cell of padding and random
// origin shift as DataBounds in WebGL. An all-absent layout has a finite box.
@compute @workgroup_size(1)
fn fitBox() {
  var lo = bounds[0].xy;
  var hi = bounds[0].zw;
  if (hi.x < lo.x) { lo = vec2f(0.0); hi = lo; }
  let center = (lo + hi) * 0.5;
  let span = hi - lo;
  let extent = max(max(span.x, span.y), minFinestCellSize * f32(settings.width));
  let cell = extent / f32(coarsestWidth - 1u);
  let origin = (center - 0.5 * extent) - settings.shift * cell;
  box = vec4f(origin, extent + cell, 1.0 / (extent + cell));
}

@compute @workgroup_size(64)
fn clearLeaves(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&heads)) { return; }
  atomicStore(&heads[id.x], 0u);
  atomicStore(&sums[id.x].count, 0u);
  atomicStore(&sums[id.x].x, 0u);
  atomicStore(&sums[id.x].y, 0u);
}

@compute @workgroup_size(64)
fn binPoints(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.count) { return; }
  let p = positions[id.x];
  if (p.w > 0.5) { return; }
  let xy = gridCell(p.xy, settings.width, box);
  let i = xy.y * settings.width + xy.x;
  next[id.x] = atomicExchange(&heads[i], id.x + 1u);

  // Accumulate offsets inside one cell using portable integer atomics. The
  // quantization is bounded for the worst case of every point in one cell.
  let q = (p.xy - box.xy) * (box.w * f32(settings.width));
  let offset = clamp(q - vec2f(xy), vec2f(0.), vec2f(1.));
  let fixed = vec2u(round(offset * f32(settings.quantization)));
  atomicAdd(&sums[i].count, 1u);
  atomicAdd(&sums[i].x, fixed.x);
  atomicAdd(&sums[i].y, fixed.y);
}

@compute @workgroup_size(64)
fn leafSums(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&heads)) { return; }
  let n = atomicLoad(&sums[i].count);
  if (n == 0u) { cells[i] = vec4f(0.); return; }
  if (n == 1u) {
    cells[i] = vec4f(positions[atomicLoad(&heads[i]) - 1u].xy, 1., 0.);
    return;
  }
  let xy = vec2u(i % settings.width, i / settings.width);
  let offset = vec2f(f32(atomicLoad(&sums[i].x)), f32(atomicLoad(&sums[i].y)));
  let fraction = offset / (f32(settings.quantization) * f32(n));
  let mean = box.xy + (vec2f(xy) + fraction) * (box.z / f32(settings.width));
  cells[i] = vec4f(mean * f32(n), f32(n), 0.);
}

// Level parameters are this width, this offset, child offset, and padding.
// Reading only the four children keeps grid construction linear in cell count.
@compute @workgroup_size(64)
fn mergeChildren(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= level.x * level.x) { return; }
  let childWidth = level.x * 2u;
  let child = level.z + (id.x / level.x * childWidth + id.x % level.x) * 2u;
  cells[level.y + id.x] = (cells[child] + cells[child + 1u]) +
    (cells[child + childWidth] + cells[child + childWidth + 1u]);
}

@compute @workgroup_size(64)
fn normalizeCells(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&cells)) { return; }
  let v = cells[id.x];
  if (v.z > 1.) { cells[id.x] = vec4f(v.xy / v.z, v.z, 0.); }
}

fn cellVelocity(position: vec2f, cell: vec4f, strength: f32) -> vec2f {
  if (cell.z == 0.) { return vec2f(0.); }
  let delta = position - cell.xy;
  let d2 = dot(delta, delta);
  if (d2 <= 0.) { return vec2f(0.); }
  let l = select(d2, sqrt(d2), d2 < 1.);
  return (strength * cell.z / sqrt(l)) * normalize(delta);
}

@compute @workgroup_size(64)
fn farForce(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.count) { return; }
  let p = positions[id.x];
  if (p.w > 0.5 || p.z > 0.5) { forces[id.x] = vec4f(0.); return; }
  let finest = settings.width;
  let pointCell = gridCell(p.xy, finest, box);
  let strength = settings.alpha * settings.strength;
  let parentRadius = select(1, 2, settings.wideShell != 0u);
  var velocity = vec2f(0.);

  // Visit the same row-major cells, with a separate sum per level, as the
  // reference additive passes. Refine the parent shell and always leave the
  // finest 3x3 neighborhood to individual near-field pairs.
  for (var width = coarsestWidth; width <= finest; width *= 2u) {
    let n = i32(width);
    let own = vec2i(pointCell / (finest / width));
    let radius = select(parentRadius, 1, width == finest);
    var first = vec2i(0);
    var end = vec2i(n);
    if (width > coarsestWidth) {
      let base = (own / 2) * 2 - 2 * parentRadius;
      first = max(base, vec2i(0));
      end = min(base + 4 * parentRadius + 2, vec2i(n));
    }
    // Sum of the areas of levels finer than this one.
    let offset = (finest * finest - width * width) * 4u / 3u;
    var sum = vec2f(0.);
    for (var y = first.y; y < end.y; y++) {
      for (var x = first.x; x < end.x; x++) {
        let distance = abs(vec2i(x, y) - own);
        if (max(distance.x, distance.y) > radius) {
          sum += cellVelocity(p.xy, cells[offset + u32(y) * width + u32(x)], strength);
        }
      }
    }
    velocity += sum;
  }
  forces[id.x] = vec4f(velocity, 0., 0.);
}
