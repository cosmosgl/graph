import type { Point, Settings } from './data'

export function resolvedEndpointColor (point: Point, settings: Settings): number[] {
  const fallback = settings.pointDefaultColor ?? [1, 1, 1, 1]
  return (point.color ?? [NaN, NaN, NaN, NaN]).map((value, channel) => Math.fround(Number.isNaN(value) ? fallback[channel] : value))
}

// Separate color pipeline: solid controls and all ID/geometry probes retain
// their original shader source. Production GLSL already contains this feature.
export function endpointColorShader (source: string, binding: number): string {
  const replace = (before: string, after: string): void => {
    if (source.split(before).length !== 2) throw new Error('Link shader changed; review endpoint-color composition')
    source = source.replace(before, after)
  }
  replace('struct Vertex {', `@group(0) @binding(${binding}) var<storage, read> pointColors: array<vec4f>;
struct Vertex {
  @location(6) @interpolate(flat) endpointA: vec3f,
  @location(7) @interpolate(flat) endpointB: vec3f,`)
  replace('result.coord = corner;', `result.endpointA = pointColors[link.endpoints.x].rgb;
  result.endpointB = pointColors[link.endpoints.y].rgb;
  result.coord = corner;`)
  const color = 'mix(input.endpointA,input.endpointB,clamp(input.coord.x,0.0,1.0))'
  replace('return vec4f(input.color.rgb,1);', `return vec4f(${color},1);`)
  replace('return vec4f(input.color.rgb,alpha);', `return vec4f(${color},alpha);`)
  return source
}
