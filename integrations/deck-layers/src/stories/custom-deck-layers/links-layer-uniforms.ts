import type { ShaderModule } from '@luma.gl/shadertools'
import type { Texture } from '@luma.gl/core'

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
