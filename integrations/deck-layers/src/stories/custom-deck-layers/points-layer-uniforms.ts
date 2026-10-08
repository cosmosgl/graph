import type { ShaderModule } from '@luma.gl/shadertools'
import type { Texture } from '@luma.gl/core'

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
