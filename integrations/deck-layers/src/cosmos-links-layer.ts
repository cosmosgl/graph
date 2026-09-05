import { Layer, type LayerContext, type UpdateParameters } from '@deck.gl/core'
import { Model } from '@luma.gl/engine'
import type { Texture } from '@luma.gl/core'
import type { Graph, GraphSimulation } from '@cosmos.gl/graph'

import { BLEND_PARAMETERS } from './blend-parameters'

const linksVs = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D positionsTexture;
uniform sampler2D linksTexture;
uniform mat4 viewProjectionMatrix;
uniform float pointsTextureSize;
uniform float linksTextureSize;

void main() {
  int linkIndex = gl_VertexID / 2;
  int endpoint = gl_VertexID - linkIndex * 2;
  int linksSize = int(linksTextureSize);
  // Link i lives at texel (i % size, i / size) as [sourceIndex, targetIndex, 0, 0]
  vec4 link = texelFetch(linksTexture, ivec2(linkIndex % linksSize, linkIndex / linksSize), 0);
  int pointIndex = int(endpoint == 0 ? link.r : link.g);
  int pointsSize = int(pointsTextureSize);
  vec4 pointPosition = texelFetch(positionsTexture, ivec2(pointIndex % pointsSize, pointIndex / pointsSize), 0);
  if (isnan(pointPosition.r)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
    return;
  }
  gl_Position = viewProjectionMatrix * vec4(pointPosition.rg, 0.0, 1.0);
}
`

const linksFs = /* glsl */ `#version 300 es
precision highp float;

uniform vec4 color;

out vec4 fragColor;

void main() {
  fragColor = color;
}
`

export type CosmosLinksLayerProps = {
  id: string;
  /** The cosmos.gl simulation (or headless Graph) whose position texture to sample. */
  graph: GraphSimulation | Graph;
  /** Flat `[source0, target0, source1, target1, …]` point indices, as passed to `graph.setLinks`. */
  links: Float32Array;
  color?: [number, number, number, number];
}

/**
 * Renders cosmos.gl links as a `line-list` draw. Link endpoint indices are
 * uploaded once into a small RGBA32F lookup texture; each vertex then chains two
 * texelFetches — link texel → endpoint index → live position texel.
 */
export class CosmosLinksLayer extends Layer<Required<CosmosLinksLayerProps>> {
  public static layerName = 'CosmosLinksLayer'
  public static defaultProps = {
    color: { type: 'array', value: [0.37, 0.45, 0.76, 0.25] },
  }

  declare public state: {
    model?: Model;
    uniforms: Record<string, unknown>;
    linksTexture?: Texture;
    linksTextureSize: number;
    linkCount: number;
  }

  public initializeState (): void {
    this.state = { uniforms: {}, linksTextureSize: 0, linkCount: 0 }
  }

  public updateState (params: UpdateParameters<this>): void {
    super.updateState(params)
    if (params.changeFlags.dataChanged || params.props.links !== params.oldProps.links) {
      this._createLinksTexture()
    }
  }

  public draw (): void {
    const positionInfo = this.props.graph.getPointPositionTexture()
    const { uniforms, linksTexture, linksTextureSize, linkCount } = this.state
    if (!positionInfo || !linksTexture || linkCount === 0) return

    this.state.model ||= new Model(this.context.device, {
      id: `${this.props.id}-model`,
      vs: linksVs,
      fs: linksFs,
      topology: 'line-list',
      vertexCount: 0,
      uniforms,
      parameters: BLEND_PARAMETERS,
    })
    const { model } = this.state

    Object.assign(uniforms, {
      viewProjectionMatrix: this.context.viewport.viewProjectionMatrix,
      pointsTextureSize: positionInfo.textureSize,
      linksTextureSize,
      color: this.props.color,
    })
    model.setBindings({
      positionsTexture: positionInfo.texture,
      linksTexture,
    })
    model.setVertexCount(linkCount * 2)
    model.draw(this.context.renderPass)
  }

  public finalizeState (context: LayerContext): void {
    this.state.model?.destroy()
    this.state.linksTexture?.destroy()
    super.finalizeState(context)
  }

  private _createLinksTexture (): void {
    const { links } = this.props
    const linkCount = Math.floor(links.length / 2)
    const linksTextureSize = Math.max(1, Math.ceil(Math.sqrt(linkCount)))
    const data = new Float32Array(linksTextureSize * linksTextureSize * 4)
    for (let i = 0; i < linkCount; i += 1) {
      data[i * 4] = links[i * 2] as number
      data[i * 4 + 1] = links[i * 2 + 1] as number
    }

    this.state.linksTexture?.destroy()
    this.state.linksTexture = this.context.device.createTexture({
      width: linksTextureSize,
      height: linksTextureSize,
      format: 'rgba32float',
      data,
    })
    this.state.linksTextureSize = linksTextureSize
    this.state.linkCount = linkCount
  }
}
