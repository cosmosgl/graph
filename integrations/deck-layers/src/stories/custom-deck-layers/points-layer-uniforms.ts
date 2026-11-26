import type { ShaderModule } from '@luma.gl/shadertools'
import type { RenderPass, Texture } from '@luma.gl/core'
import type { Model } from '@luma.gl/engine'
import type { PositionTextureSource } from '@cosmos.gl/graph'

const uniformBlock = `\
layout(std140) uniform pointsLayerUniforms {
  float pointsTextureSize;
  highp int sizeUnits;
} pointsLayer;
`

type PointsLayerBindingProps = {
  positionsTexture: Texture;
}

type PointsLayerUniformProps = {
  pointsTextureSize: number;
  sizeUnits: number;
}

export type PointsLayerModuleProps = PointsLayerBindingProps & PointsLayerUniformProps

export const pointsLayerUniforms = {
  name: 'pointsLayer',
  vs: uniformBlock,
  uniformTypes: {
    pointsTextureSize: 'f32',
    sizeUnits: 'i32',
  },
} as const satisfies ShaderModule<PointsLayerModuleProps>

export type PositionSource = PositionTextureSource

export function drawPoints (model: Model, source: PositionSource, sizeUnits: number, pass: RenderPass): void {
  const positions = source.getPointPositionTexture()
  if (!positions?.pointCount) return
  const uniforms: PointsLayerModuleProps = {
    sizeUnits, pointsTextureSize: positions.textureSize, positionsTexture: positions.texture,
  }
  model.shaderInputs.setProps({ pointsLayer: uniforms })
  model.draw(pass)
}

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME points-layer-vertex-shader

in vec3 positions;

in float instanceSizes;
in vec4 instanceColors;
in vec3 instancePickingColors;

uniform sampler2D positionsTexture;

out vec4 vColor;
out vec2 unitPosition;
out float outerRadiusPixels;

// Collapse the quad so it clips away: nothing rasterizes, nothing picks
void collapse() {
  gl_Position = vec4(0.0);
  unitPosition = vec2(0.0);
  outerRadiusPixels = 0.0;
  vColor = vec4(0.0);
}

void main(void) {
  int pointIndex = gl_InstanceID;
  int textureSize = int(pointsLayer.pointsTextureSize);
  // Point i lives at texel (i % size, i / size) as [x, y, i, unused] in space coordinates
  vec4 pointPosition = texelFetch(positionsTexture, ivec2(pointIndex % textureSize, pointIndex / textureSize), 0);

  // A removed (absent) point's texel is NaN — see PointPositionTexture
  if (isnan(pointPosition.x)) {
    collapse();
    return;
  }

  geometry.worldPosition = vec3(pointPosition.xy, 0.0);
  geometry.pickingColor = instancePickingColors;

  // instanceSizes is a diameter; the quad expands by radius
  outerRadiusPixels = project_size_to_pixel(instanceSizes * 0.5, pointsLayer.sizeUnits);
  // A non-positive size hides the point — and the edge-padding divide below
  // is undefined at zero. Written so NaN hides it too: NaN fails every comparison.
  if (!(outerRadiusPixels > 0.0)) {
    collapse();
    return;
  }
  // Expand the quad so edge smoothing has room outside the circle
  float edgePadding = (outerRadiusPixels + SMOOTH_EDGE_RADIUS) / outerRadiusPixels;

  unitPosition = edgePadding * positions.xy;
  geometry.uv = unitPosition;

  vec3 offset = vec3(edgePadding * positions.xy * project_pixel_size(outerRadiusPixels), 0.0);
  DECKGL_FILTER_SIZE(offset, geometry);
  gl_Position = project_position_to_clipspace(geometry.worldPosition, vec3(0.0), offset, geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  vColor = vec4(instanceColors.rgb, instanceColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME points-layer-fragment-shader

precision highp float;

in vec4 vColor;
in vec2 unitPosition;
in float outerRadiusPixels;

out vec4 fragColor;

void main(void) {
  geometry.uv = unitPosition;

  float distToCenter = length(unitPosition) * outerRadiusPixels;
  float inCircle = smoothedge(distToCenter, outerRadiusPixels);
  if (inCircle == 0.0) {
    discard;
  }

  fragColor = vec4(vColor.rgb, vColor.a * inCircle);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`

export const pointsShaders = { vs, fs }
