import { Layer, type LayerContext } from '@deck.gl/core'
import { Model } from '@luma.gl/engine'
import type { Graph, GraphSimulation } from '@cosmos.gl/graph'

import { BLEND_PARAMETERS } from './blend-parameters'

const pointsVs = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D positionsTexture;
uniform mat4 viewProjectionMatrix;
uniform float pointsTextureSize;
uniform float pointSize;

void main() {
  int size = int(pointsTextureSize);
  int index = gl_VertexID;
  // Point i lives at texel (i % size, i / size) as [x, y, i, unused] in space coordinates
  vec4 pointPosition = texelFetch(positionsTexture, ivec2(index % size, index / size), 0);
  // An absent point keeps a frozen NaN-adjacent state; cull it off-screen
  if (isnan(pointPosition.r)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = viewProjectionMatrix * vec4(pointPosition.rg, 0.0, 1.0);
  gl_PointSize = pointSize;
}
`

const pointsFs = /* glsl */ `#version 300 es
precision highp float;

uniform vec4 color;

out vec4 fragColor;

void main() {
  vec2 fromCenter = gl_PointCoord * 2.0 - 1.0;
  float distSquared = dot(fromCenter, fromCenter);
  if (distSquared > 1.0) discard;
  fragColor = vec4(color.rgb, color.a * (1.0 - smoothstep(0.64, 1.0, distSquared)));
}
`

export type CosmosPointsLayerProps = {
  id: string;
  /** The cosmos.gl simulation (or headless Graph) whose position texture to sample. */
  graph: GraphSimulation | Graph;
  color?: [number, number, number, number];
  /** Point diameter in pixels. */
  pointSize?: number;
}

/**
 * Renders every cosmos.gl point as an instanceless `point-list` draw: the vertex
 * shader derives each point's texel from `gl_VertexID` — no position attribute,
 * no CPU copy, no per-frame attribute updates.
 */
export class CosmosPointsLayer extends Layer<Required<CosmosPointsLayerProps>> {
  public static layerName = 'CosmosPointsLayer'
  public static defaultProps = {
    color: { type: 'array', value: [0.29, 0.36, 0.75, 0.9] },
    pointSize: 4,
  }

  declare public state: { model?: Model; uniforms: Record<string, unknown> }

  public initializeState (): void {
    this.state = { uniforms: {} }
  }

  public draw (): void {
    const positionInfo = this.props.graph.getPointPositionTexture()
    if (!positionInfo) return

    const { uniforms } = this.state
    this.state.model ||= new Model(this.context.device, {
      id: `${this.props.id}-model`,
      vs: pointsVs,
      fs: pointsFs,
      topology: 'point-list',
      vertexCount: 0,
      uniforms,
      parameters: BLEND_PARAMETERS,
    })
    const { model } = this.state

    // The Model holds this record by reference and re-reads it on every draw
    Object.assign(uniforms, {
      viewProjectionMatrix: this.context.viewport.viewProjectionMatrix,
      pointsTextureSize: positionInfo.textureSize,
      pointSize: this.props.pointSize,
      color: this.props.color,
    })
    model.setBindings({ positionsTexture: positionInfo.texture })
    model.setVertexCount(positionInfo.pointCount)
    model.draw(this.context.renderPass)
  }

  public finalizeState (context: LayerContext): void {
    this.state.model?.destroy()
    super.finalizeState(context)
  }
}
