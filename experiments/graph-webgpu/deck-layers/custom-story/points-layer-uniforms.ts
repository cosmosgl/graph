import type { GraphSimulation } from '@cosmos.gl/graph'
import type { RenderPass } from '@luma.gl/core'
import type { Model } from '@luma.gl/engine'
import type { ShaderModule } from '@luma.gl/shaders'

export type PositionSource = Pick<GraphSimulation, 'getPointPositionBuffer'>

export const pointsLayerUniforms = {
  name: 'pointsLayer',
  uniformTypes: { sizeUnits: 'i32' },
} as const satisfies ShaderModule<{ sizeUnits: number }>

export function drawPoints (model: Model, source: PositionSource, sizeUnits: number, pass: RenderPass): void {
  const positions = source.getPointPositionBuffer()
  if (!positions?.pointCount) return
  // A simulation step can swap the current storage buffer between two Deck passes.
  model.setBindings({ pointPositions: positions.buffer })
  model.shaderInputs.setProps({ pointsLayer: { sizeUnits } })
  model.draw(pass)
}

// Both custom layers encode Deck's object index and honor its current auto-highlight.
// The shared layer blend parameters accept straight-alpha colors.
export const pickingAndHighlight = /* wgsl */ `
fn objectColor(color: vec4<f32>, idColor: vec3<f32>) -> vec4<f32> {
  if (picking.isActive > 0.5) {
    if (!picking_isColorValid(idColor)) { discard; }
    return vec4<f32>(idColor, 1.0);
  }
  if (picking.isHighlightActive > 0.5 && picking_isColorZero(abs(idColor - picking_normalizeColor(picking.highlightedObjectColor)))) {
    let highlight = picking.highlightColor;
    let alpha = highlight.a + color.a * (1.0 - highlight.a);
    if (alpha > 0.0) { return vec4<f32>(mix(color.rgb, highlight.rgb, highlight.a / alpha), alpha); }
  }
  return color;
}
`

export const pointsShaders = {
  source: /* wgsl */ `
struct PointsLayerUniforms { sizeUnits: i32 };
@group(0) @binding(auto) var<uniform> pointsLayer: PointsLayerUniforms;
@group(0) @binding(auto) var<storage, read> pointPositions: array<vec4<f32>>;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) unitPosition: vec2<f32>,
  @location(2) radius: f32,
  @location(3) @interpolate(flat) idColor: vec3<f32>,
};

@vertex fn vertexMain(
  @builtin(instance_index) id: u32,
  @location(0) positions: vec3<f32>, @location(1) instanceSizes: f32, @location(2) instanceColors: vec4<f32>
) -> VertexOutput {
  var result: VertexOutput;
  result.position = vec4<f32>(0, 0, 2, 1);
  if (id >= arrayLength(&pointPositions)) { return result; }
  let point = pointPositions[id];
  let radius = project_unit_size_to_pixel(instanceSizes * 0.5, pointsLayer.sizeUnits);
  if (point.w > 0.5 || !(radius > 0.0)) { return result; }
  let unit = positions.xy * ((radius + SMOOTH_EDGE_RADIUS) / radius);
  let world = vec3<f32>(point.xy, 0.0);
  var offset = vec3<f32>(unit * project_pixel_size_float(radius), 0.0);
  geometry.worldPosition = world;
  geometry.uv = unit;
  geometry.pickingColor = picking_getPickingColorFromIndex(id);
  DECKGL_FILTER_SIZE(&offset, geometry);
  let projected = project_position_to_clipspace_and_commonspace(world, vec3<f32>(0.0), offset);
  geometry.position = projected.commonPosition;
  result.position = projected.clipPosition;
  DECKGL_FILTER_GL_POSITION(&result.position, geometry);
  result.unitPosition = unit;
  result.radius = radius;
  result.color = vec4<f32>(instanceColors.rgb, instanceColors.a * layer.opacity);
  result.idColor = geometry.pickingColor;
  return result;
}

${pickingAndHighlight}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let coverage = smoothedge(length(input.unitPosition) * input.radius, input.radius);
  if (coverage == 0.0) { discard; }
  var color = vec4<f32>(input.color.rgb, input.color.a * coverage);
  fragmentGeometry.uv = input.unitPosition;
  DECKGL_FILTER_COLOR(&color, fragmentGeometry);
  return objectColor(color, input.idColor);
}
`,
}
