struct Params {
  translation: vec2f, viewport: vec2f,
  grid: vec2u, count: u32, links: u32,
  zoom: f32, bend: f32, ordered: u32, pad: u32,
}
@group(0) @binding(0) var<storage, read> points: array<vec4f>;
@group(0) @binding(1) var<storage, read> edges: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> winners: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> result: array<vec4u>;
@group(0) @binding(4) var<uniform> view: Params;
@group(0) @binding(5) var<storage, read> drawOrder: array<u32>;

fn sourceId(slot: u32) -> u32 {
  if (view.ordered != 0u) { return drawOrder[slot]; }
  return slot;
}

fn label(i: u32) -> vec4f {
  if (view.links == 0u) {
    let p = points[i];
    return vec4f(p.xy, 0, p.w);
  }
  let e = edges[i];
  if (any(e < vec2f(0)) || any(e != floor(e)) || any(e >= vec2f(f32(arrayLength(&points))))) { return vec4f(0,0,0,1); }
  let a = points[u32(e.x)];
  let b = points[u32(e.y)];
  let d = b.xy - a.xy;
  let middle = a.xy + 0.5 * d + vec2f(-d.y, d.x) * view.bend;
  return vec4f(middle, -atan2(d.y, d.x), max(a.w, b.w));
}

@compute @workgroup_size(64)
fn selectCells(@builtin(global_invocation_id) invocation: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let id = invocation.x + invocation.y * groups.x * 64u;
  if (id >= view.count) { return; }
  let p = label(sourceId(id));
  let xy = view.translation + p.xy * vec2f(view.zoom, -view.zoom);
  let uv = (vec2f(xy.x, view.viewport.y - xy.y) + 0.5) / view.viewport;
  if (p.w != 0.0 || any(uv < vec2f(0)) || any(uv >= vec2f(1))) { return; }
  let cell = vec2u(uv * vec2f(view.grid));
  atomicMax(&winners[cell.x + cell.y * view.grid.x], id + 1u);
}

@compute @workgroup_size(64)
fn gatherCells(@builtin(global_invocation_id) invocation: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let id = invocation.x + invocation.y * groups.x * 64u;
  if (id >= arrayLength(&result)) { return; }
  let winner = atomicLoad(&winners[id]);
  if (winner != 0u) {
    let i = sourceId(winner - 1u);
    let p = label(i);
    result[id] = vec4u(i + 1u, bitcast<vec3u>(p.xyz));
  }
}
