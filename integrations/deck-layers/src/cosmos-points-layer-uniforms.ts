import type { ShaderModule } from '@luma.gl/shadertools'
import type { Texture } from '@luma.gl/core'

const uniformBlock = `\
layout(std140) uniform cosmosPointsUniforms {
  float pointsTextureSize;
  highp int sizeUnits;
} cosmosPoints;
`

type CosmosPointsBindingProps = {
  positionsTexture: Texture;
}

type CosmosPointsUniformProps = {
  pointsTextureSize: number;
  sizeUnits: number;
}

export type CosmosPointsProps = CosmosPointsBindingProps & CosmosPointsUniformProps

export const cosmosPointsUniforms = {
  name: 'cosmosPoints',
  vs: uniformBlock,
  uniformTypes: {
    pointsTextureSize: 'f32',
    sizeUnits: 'i32',
  },
} as const satisfies ShaderModule<CosmosPointsProps>
