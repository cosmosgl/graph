import type { ShaderModule } from '@luma.gl/shadertools'
import type { RenderPass, Texture } from '@luma.gl/core'
import type { Model } from '@luma.gl/engine'
import type { PositionTextureSource } from '@cosmos.gl/graph'

const uniformBlock = `\
layout(std140) uniform linksLayerUniforms {
  float pointsTextureSize;
  highp int widthUnits;
  float pointCount;
} linksLayer;
`

type LinksLayerBindingProps = {
  positionsTexture: Texture;
}

type LinksLayerUniformProps = {
  pointsTextureSize: number;
  widthUnits: number;
  pointCount: number;
}

export type LinksLayerModuleProps = LinksLayerBindingProps & LinksLayerUniformProps

export const linksLayerUniforms = {
  name: 'linksLayer',
  vs: uniformBlock,
  uniformTypes: {
    pointsTextureSize: 'f32',
    widthUnits: 'i32',
    pointCount: 'f32',
  },
} as const satisfies ShaderModule<LinksLayerModuleProps>

export type PositionSource = PositionTextureSource

export function drawLinks (model: Model, source: PositionSource, widthUnits: number, pass: RenderPass): void {
  const positions = source.getPointPositionTexture()
  if (!positions?.pointCount) return
  const uniforms: LinksLayerModuleProps = {
    widthUnits, pointCount: positions.pointCount, pointsTextureSize: positions.textureSize, positionsTexture: positions.texture,
  }
  model.shaderInputs.setProps({ linksLayer: uniforms })
  model.draw(pass)
}

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME links-layer-vertex-shader

in vec3 positions;

in float instanceSourceIndices;
in float instanceTargetIndices;
in vec4 instanceColors;
in float instanceWidths;
in vec3 instancePickingColors;

uniform sampler2D positionsTexture;

out vec4 vColor;
out vec2 uv;

// Offset the vertex by half the link width, perpendicular to the link, in
// screen space. offsetDirection is -1 (left) or 1 (right).
vec2 getExtrusionOffset(vec2 lineClipspace, float offsetDirection, float width) {
  vec2 dirScreenspace = normalize(lineClipspace * project.viewportSize);
  dirScreenspace = vec2(-dirScreenspace.y, dirScreenspace.x);
  return dirScreenspace * offsetDirection * width / 2.0;
}

// The engine's isPointIndex: an integer in [0, pointCount). A fraction would
// truncate to a neighbour, NaN would make int() undefined.
bool namesPoint(float index, float pointCount) {
  return index >= 0.0 && index < pointCount && index == floor(index);
}

vec4 fetchPointPosition(float index, int textureSize) {
  int pointIndex = int(index);
  // Point i lives at texel (i % size, i / size) as [x, y, i, unused] in space coordinates
  return texelFetch(positionsTexture, ivec2(pointIndex % textureSize, pointIndex / textureSize), 0);
}

void main(void) {
  // An endpoint that names no point (an index outside the point count) is
  // skipped, never dropped, so the instance index stays the link index — the
  // rule the engine applies to the same pair in its link grouping. Its texel
  // would be outside the live data.
  float pointCount = linksLayer.pointCount;
  bool namesNoPoint = !namesPoint(instanceSourceIndices, pointCount) || !namesPoint(instanceTargetIndices, pointCount);

  int textureSize = int(linksLayer.pointsTextureSize);
  vec4 sourcePosition = namesNoPoint ? vec4(0.0) : fetchPointPosition(instanceSourceIndices, textureSize);
  vec4 targetPosition = namesNoPoint ? vec4(0.0) : fetchPointPosition(instanceTargetIndices, textureSize);

  // A removed (absent) endpoint's texel is NaN — see PointPositionTexture;
  // collapse the quad, as for an endpoint that names no point, so it clips away
  if (namesNoPoint || isnan(sourcePosition.x) || isnan(targetPosition.x)) {
    gl_Position = vec4(0.0);
    vColor = vec4(0.0);
    uv = vec2(0.0);
    return;
  }

  vec3 sourceWorld = vec3(sourcePosition.xy, 0.0);
  vec3 targetWorld = vec3(targetPosition.xy, 0.0);
  geometry.worldPosition = sourceWorld;
  geometry.worldPositionAlt = targetWorld;

  vec4 sourceCommonspace;
  vec4 targetCommonspace;
  vec4 source = project_position_to_clipspace(sourceWorld, vec3(0.0), vec3(0.0), sourceCommonspace);
  vec4 target = project_position_to_clipspace(targetWorld, vec3(0.0), vec3(0.0), targetCommonspace);

  // positions.x selects the endpoint, positions.y the extrusion side
  float segmentIndex = positions.x;
  vec4 p = mix(source, target, segmentIndex);
  geometry.position = mix(sourceCommonspace, targetCommonspace, segmentIndex);
  uv = positions.xy;
  geometry.uv = uv;
  geometry.pickingColor = instancePickingColors;

  float widthPixels = project_size_to_pixel(instanceWidths, linksLayer.widthUnits);

  // The link's direction on screen: each end divided by its own w, which differs
  // between the two under a pitched view
  vec3 offset = vec3(getExtrusionOffset(target.xy / target.w - source.xy / source.w, positions.y, widthPixels), 0.0);
  DECKGL_FILTER_SIZE(offset, geometry);
  DECKGL_FILTER_GL_POSITION(p, geometry);
  gl_Position = p + vec4(project_pixel_size_to_clipspace(offset.xy), 0.0, 0.0);

  vColor = vec4(instanceColors.rgb, instanceColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME links-layer-fragment-shader

precision highp float;

in vec4 vColor;
in vec2 uv;

out vec4 fragColor;

void main(void) {
  geometry.uv = uv;

  fragColor = vColor;
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`

export const linksShaders = { vs, fs }
