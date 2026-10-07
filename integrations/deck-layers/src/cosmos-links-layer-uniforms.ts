import type { ShaderModule } from '@luma.gl/shadertools'
import type { Texture } from '@luma.gl/core'

const uniformBlock = `\
layout(std140) uniform cosmosLinksUniforms {
  float pointsTextureSize;
  highp int widthUnits;
  float pointCount;
  float controlPointDistance;
  float curveWeight;
  float curveSegments;
} cosmosLinks;
`

type CosmosLinksBindingProps = {
  positionsTexture: Texture;
}

type CosmosLinksUniformProps = {
  pointsTextureSize: number;
  widthUnits: number;
  pointCount: number;
  /** The curve's control point, in link lengths from the midpoint; 0 draws straight links. */
  controlPointDistance: number;
  curveWeight: number;
  /** Segments in the strip each link is drawn with: 1 for straight links. */
  curveSegments: number;
}

export type CosmosLinksProps = CosmosLinksBindingProps & CosmosLinksUniformProps

export const cosmosLinksUniforms = {
  name: 'cosmosLinks',
  vs: uniformBlock,
  uniformTypes: {
    pointsTextureSize: 'f32',
    widthUnits: 'i32',
    pointCount: 'f32',
    controlPointDistance: 'f32',
    curveWeight: 'f32',
    curveSegments: 'f32',
  },
} as const satisfies ShaderModule<CosmosLinksProps>
