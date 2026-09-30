import type { ShaderModule } from '@luma.gl/shadertools'
import type { Texture } from '@luma.gl/core'

const uniformBlock = `\
layout(std140) uniform cosmosLinksUniforms {
  float pointsTextureSize;
  highp int widthUnits;
  float pointCount;
} cosmosLinks;
`

type CosmosLinksBindingProps = {
  positionsTexture: Texture;
}

type CosmosLinksUniformProps = {
  pointsTextureSize: number;
  widthUnits: number;
  pointCount: number;
}

export type CosmosLinksProps = CosmosLinksBindingProps & CosmosLinksUniformProps

export const cosmosLinksUniforms = {
  name: 'cosmosLinks',
  vs: uniformBlock,
  uniformTypes: {
    pointsTextureSize: 'f32',
    widthUnits: 'i32',
    pointCount: 'f32',
  },
} as const satisfies ShaderModule<CosmosLinksProps>
