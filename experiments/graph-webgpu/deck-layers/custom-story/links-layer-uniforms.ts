import type { RenderPass } from '@luma.gl/core'
import type { Model } from '@luma.gl/engine'
import type { ShaderModule } from '@luma.gl/shaders'
import { pickingAndHighlight, type PositionSource } from './points-layer-uniforms'

export type { PositionSource } from './points-layer-uniforms'

export const linksLayerUniforms = {
  name: 'linksLayer',
  uniformTypes: { widthUnits: 'i32', pointCount: 'u32' },
} as const satisfies ShaderModule<{ widthUnits: number; pointCount: number }>

export function drawLinks (model: Model, source: PositionSource, widthUnits: number, pass: RenderPass): void {
  const positions = source.getPointPositionBuffer()
  if (!positions?.pointCount) return
  model.setBindings({ pointPositions: positions.buffer })
  model.shaderInputs.setProps({ linksLayer: { widthUnits, pointCount: positions.pointCount } })
  model.draw(pass)
}

export const linksShaders = {
  source: /* wgsl */ `
struct LinksLayerUniforms { widthUnits: i32, pointCount: u32 };
@group(0) @binding(auto) var<uniform> linksLayer: LinksLayerUniforms;
@group(0) @binding(auto) var<storage, read> pointPositions: array<vec4<f32>>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) @interpolate(flat) idColor: vec3<f32>,
};
fn namesPoint(index: f32) -> bool {
  return index >= 0.0 && index < f32(linksLayer.pointCount) && index == floor(index);
}

@vertex fn vertexMain(
  @builtin(instance_index) id: u32, @location(0) positions: vec3<f32>,
  @location(1) instanceSourceIndices: f32, @location(2) instanceTargetIndices: f32,
  @location(3) instanceColors: vec4<f32>, @location(4) instanceWidths: f32
) -> VertexOutput {
  var result: VertexOutput;
  result.position = vec4<f32>(0, 0, 2, 1);
  if (!namesPoint(instanceSourceIndices) || !namesPoint(instanceTargetIndices)) { return result; }
  let source = pointPositions[u32(instanceSourceIndices)];
  let targetPoint = pointPositions[u32(instanceTargetIndices)];
  if (source.w > 0.5 || targetPoint.w > 0.5) { return result; }
  geometry.worldPosition = vec3<f32>(source.xy, 0.0);
  geometry.worldPositionAlt = vec3<f32>(targetPoint.xy, 0.0);
  let s = project_position_to_clipspace_and_commonspace(geometry.worldPosition, vec3<f32>(0.0), vec3<f32>(0.0));
  let t = project_position_to_clipspace_and_commonspace(geometry.worldPositionAlt, vec3<f32>(0.0), vec3<f32>(0.0));
  let delta = (t.clipPosition.xy / t.clipPosition.w - s.clipPosition.xy / s.clipPosition.w) * project.viewportSize;
  if (dot(delta, delta) == 0.0) { return result; }
  let normal = normalize(vec2<f32>(delta.y, -delta.x));
  let width = project_unit_size_to_pixel(instanceWidths, linksLayer.widthUnits);
  var offset = vec3<f32>(normal * positions.y * width * 0.5, 0.0);
  geometry.position = mix(s.commonPosition, t.commonPosition, positions.x);
  geometry.uv = positions.xy;
  geometry.pickingColor = picking_getPickingColorFromIndex(id);
  DECKGL_FILTER_SIZE(&offset, geometry);
  result.position = mix(s.clipPosition, t.clipPosition, positions.x);
  DECKGL_FILTER_GL_POSITION(&result.position, geometry);
  result.position += vec4<f32>(project_pixel_size_to_clipspace(offset.xy), 0, 0);
  result.color = vec4<f32>(instanceColors.rgb, instanceColors.a * layer.opacity);
  result.uv = positions.xy;
  result.idColor = geometry.pickingColor;
  return result;
}

${pickingAndHighlight}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  var color = input.color;
  fragmentGeometry.uv = input.uv;
  DECKGL_FILTER_COLOR(&color, fragmentGeometry);
  return objectColor(color, input.idColor);
}
`,
}
