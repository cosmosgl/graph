import { replaceOnce } from '../many-body-grid/trace'
import { distanceSpringSource } from './spring-precision'
export type SpringOptimization = 'baseline' | 'hoist' | 'prefetch'
export const HUB_THRESHOLD = 64
export const HUB_TILE = 64
export function hoistedSpringSource (): string {
  let source = distanceSpringSource('products')
  source = replaceOnce(source, 'var velocity = vec2<f32>(0.0);',
    'var velocity = vec2<f32>(0.0);\n  let springScale = roundedProduct(params.spring, params.alpha);')
  return replaceOnce(source, 'roundedProduct(length, roundedProduct(params.spring, params.alpha))', 'roundedProduct(length, springScale)')
}
// Prefetch changes memory scheduling, never the serial velocity recurrence.
// Both pieces below are extracted from the existing corrected spring source.
export function prefetchSpringSources (): { regular: string; hub: string } {
  const source = hoistedSpringSource()
  const main = source.indexOf('@compute @workgroup_size(64)')
  const rest = source.indexOf('    var rest = '); const delta = source.indexOf('    let delta = ')
  const end = source.indexOf('\n  }\n  forces[i]')
  if (main < 0 || rest < main || delta < rest || end < delta) throw new Error('Spring source markers changed')
  const regular = replaceOnce(source, 'let point = positions[i];',
    `if (offsets[i + 1u] - offsets[i] >= ${HUB_THRESHOLD}u) { return; }\n  let point = positions[i];`)
  const hub = `${source.slice(0, main)}
@group(0) @binding(6) var<storage, read> hubs: array<u32>;
var<workgroup> sharedEdges: array<Edge, ${HUB_TILE}>;
var<workgroup> sharedPoints: array<vec4f, ${HUB_TILE}>;
var<workgroup> sharedRest: array<f32, ${HUB_TILE}>;
var<workgroup> hubRange: vec2u;
@compute @workgroup_size(${HUB_TILE})
fn main(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
  let i = hubs[group.x]; let point = positions[i];
  var velocity = vec2<f32>(0.0);
  let springScale = roundedProduct(params.spring, params.alpha);
  if (lane == 0u) { hubRange = vec2u(offsets[i], offsets[i + 1u]); }
  let segment = workgroupUniformLoad(&hubRange);
  for (var block = segment.x; block < segment.y; block += ${HUB_TILE}u) {
    let e = block + lane;
    if (e < segment.y) {
      let edge = edges[e]; let other = positions[edge.other];
      sharedEdges[lane] = edge; sharedPoints[lane] = other;
${source.slice(rest, delta)}
      sharedRest[lane] = rest;
    }
    workgroupBarrier();
    if (lane == 0u) {
      for (var slot = 0u; slot < min(${HUB_TILE}u, segment.y - block); slot++) {
        let edge = sharedEdges[slot]; let other = sharedPoints[slot];
        if (other.w > 0.5) { continue; }
        let rest = sharedRest[slot];
${source.slice(delta, end)}
      }
    }
    workgroupBarrier();
  }
  if (lane == 0u) { forces[i] = vec4<f32>(velocity, 0.0, 0.0); }
}`
  return { regular, hub }
}
