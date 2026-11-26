struct PickBounds {
  viewport: vec4f,
  projection: vec4f,
  region: vec4f,
  query: vec4f, // CSS link pixel, point size scale, CSS link width scale
  width: vec4f, // arrow multiplier, extra CSS half-width, point zoom, projection / zoom
  count: vec4u, // points, links, pointer window
  pointRecords: u32,
}
@group(0) @binding(0) var<uniform> params: PickBounds;
@group(0) @binding(1) var<storage,read> positions: array<vec4f>;
@group(0) @binding(2) var<storage,read> points: array<Point>;
@group(0) @binding(3) var<storage,read> order: array<u32>;
@group(0) @binding(4) var<storage,read> links: array<Link>;
// One bit per original draw instance and type. Offsets count candidate links and points respectively.
struct PickBlock {
  mask: array<vec2u,4>,
  offset: vec2u,
  coversPointSample: u32,
}
@group(0) @binding(5) var<storage,read_write> blocks: array<PickBlock>;
@group(0) @binding(6) var<storage,read_write> draws: array<vec4u,2>;
@group(0) @binding(7) var<storage,read_write> pointIndices: array<u32>;
@group(0) @binding(8) var<storage,read_write> linkIndices: array<u32>;
var<workgroup> masks: array<atomic<u32>,8>;
var<workgroup> covered: atomic<u32>;
var<workgroup> sums: array<vec3u,128>;

fn ndc(world: vec2f) -> vec2f {
  return ((world - params.viewport.xy) * (2.0 / params.viewport.zw)) * params.projection.xy + params.projection.zw;
}

@compute @workgroup_size(128)
fn candidates(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3u) {
  if (lane == 0u) { atomicStore(&covered,0u); }
  if (lane < 8u) { atomicStore(&masks[lane],0u); }
  workgroupBarrier();
  let word = lane / 32u;
  let bit = 1u << (lane % 32u);
  let i = id.x;
  if (i < params.count.x) {
    let point = order[i];
    let p = positions[point];
    let center = (ndc(p.xy) * 0.5 + 0.5) * params.region.zw;
    let metrics = readCurrentPoint(point, params.pointRecords).metrics;
    let diameter = max(metrics.x, metrics.w) * params.query.z * params.width.z;
    let radius = max(diameter * (params.region.z / params.viewport.z) * 0.5, 1.0) * 1.000001 + 2.0;
    if (p.w <= 0.5 && diameter > 0.0 && all(center + radius >= params.region.xy) && all(center - radius <= params.region.xy + f32(params.count.z))) {
      atomicOr(&masks[word + 4u],bit);
      // A positive circle has at least a one-texel radius. A center strictly
      // inside the window always covers a sample, at most sqrt(0.5) texels
      // away. The pointer gives any point in the window priority over a link.
      if (diameter <= params.viewport.z && all(center > params.region.xy + 1.0) &&
          all(center < params.region.xy + f32(params.count.z) - 1.0)) {
        atomicStore(&covered,1u);
      }
    }
  }
  if (i < params.count.y) {
    let edge = links[i].geometry;
    let a = positions[u32(edge.x)];
    let b = positions[u32(edge.y)];
    let start = (ndc(a.xy) * vec2f(0.5,-0.5) + 0.5) * params.viewport.zw;
    let end = (ndc(b.xy) * vec2f(0.5,-0.5) + 0.5) * params.viewport.zw;
    let arrow = edge.w >= 4.0;
    let width = min(edge.z * params.query.w * select(1.0,params.width.x,arrow), select(64.0,128.0,arrow));
    // The rasterizer offsets the endpoints in world space before projecting;
    // allow a float rounding unit at either endpoint as well as the AA fringe.
    let worldRoundoff = max(abs(a.xy),abs(b.xy)) * abs(params.projection.xy) * 0.00000024;
    let pad = (0.5 * width + params.width.y) * params.width.w + worldRoundoff + 2.0;
    if (edge.z > 0.0 && any(a.xy != b.xy) && a.w <= 0.5 && b.w <= 0.5 && all(params.query.xy >= min(start,end) - pad) && all(params.query.xy <= max(start,end) + pad)) {
      atomicOr(&masks[word],bit);
    }
  }
  workgroupBarrier();
  if (lane == 0u) {
    var count = vec2u(0);
    for (var j = 0u; j < 4u; j++) {
      let bits = vec2u(atomicLoad(&masks[j]),atomicLoad(&masks[j + 4u]));
      blocks[group.x].mask[j] = bits;
      count += countOneBits(bits);
    }
    blocks[group.x].offset = count;
    blocks[group.x].coversPointSample = atomicLoad(&covered);
  }
}

// Divide the small block-count array among 128 lanes. Shift each chunk's local
// offsets by its exclusive scan so candidates retain their original draw order.
@compute @workgroup_size(128)
fn prefix(@builtin(local_invocation_index) lane: u32) {
  let count = params.count.w;
  let chunk = (count + 127u) / 128u;
  let start = lane * chunk;
  let end = min(start + chunk,count);
  var total = vec3u(0);
  for (var i = start; i < end; i++) {
    let hits = blocks[i].offset;
    blocks[i].offset = total.xy;
    total += vec3u(hits,blocks[i].coversPointSample);
  }
  sums[lane] = total;
  for (var stride = 1u; stride < 128u; stride *= 2u) {
    workgroupBarrier();
    var add = vec3u(0);
    if (lane >= stride) { add = sums[lane - stride]; }
    workgroupBarrier();
    sums[lane] += add;
  }
  let base = sums[lane] - total;
  for (var i = start; i < end; i++) { blocks[i].offset += base.xy; }
  if (lane == 127u) {
    draws[0] = vec4u(4u,select(sums[lane].x,0u,sums[lane].z > 0u),0u,0u);
    draws[1] = vec4u(4u,sums[lane].y,0u,0u);
  }
}

@compute @workgroup_size(128)
fn compact(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) group: vec3u) {
  let word = lane / 32u;
  let bit = 1u << (lane % 32u);
  let mask = blocks[group.x].mask[word];
  let hit = mask & vec2u(bit);
  if (all(hit == vec2u(0))) { return; }
  var index = blocks[group.x].offset + countOneBits(mask & vec2u(bit - 1u));
  for (var j = 0u; j < word; j++) { index += countOneBits(blocks[group.x].mask[j]); }
  if (hit.x != 0u) { linkIndices[index.x] = id.x; }
  if (hit.y != 0u) { pointIndices[index.y] = id.x; }
}
