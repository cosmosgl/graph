struct Freeze { time: f32, animate: f32, oldCount: u32, records: u32, priorRecords: u32, nextRecords: u32, compact: u32, mixShared: u32 }
@group(0) @binding(0) var<storage, read> prior: array<Point>;
@group(0) @binding(1) var<storage, read> next: array<Point>;
@group(0) @binding(2) var<storage, read_write> result: array<Point>;
@group(0) @binding(3) var<uniform> state: Freeze;
@group(0) @binding(4) var<storage, read> ids: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let slot = invocation.x + invocation.y * groups.x * 64u;
  if (slot >= state.records) { return; }
  if (state.compact != 0u && slot == 0u) {
    var base = next[0];
    if (state.mixShared != 0u) { base = interpolatePoint(prior[0], base, state.time, state.animate); }
    result[slot] = base;
    return;
  }
  var id = slot;
  if (state.compact != 0u) { id = ids[slot - 1u]; }
  var p = readTarget(id, state.nextRecords);
  if (id < state.oldCount) { p = interpolatePoint(readPrior(id, state.priorRecords), p, state.time, state.animate); }
  if (state.compact != 0u) { p.effects.z = bitcast<f32>(id); }
  result[slot] = p;
}
