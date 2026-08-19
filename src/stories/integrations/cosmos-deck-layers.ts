import { Layer, type LayerContext } from '@deck.gl/core'
import { Model } from '@luma.gl/engine'
import type { Texture } from '@luma.gl/core'
import type { Graph } from '@cosmos.gl/graph'

/**
 * Custom deck.gl layers that render a headless cosmos.gl simulation with **zero
 * position readback**: each draw samples the live GPU position texture exposed by
 * `graph.getPointPositionTexture()` with `texelFetch`, so point coordinates never
 * leave the GPU. Both layers share deck.gl's device with the cosmos.gl simulation.
 *
 * The layers draw with plain WebGL uniforms (`model.props.uniforms`, read on every
 * draw) and the viewport's view-projection matrix, so deck.gl's pan/zoom applies
 * without involving deck.gl's shader modules — the point here is to demonstrate
 * the texture-sampling contract, not production-grade layer authoring.
 */

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

const BLEND_PARAMETERS = {
  depthWriteEnabled: false,
  depthCompare: 'always',
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
} as const

type CosmosPointsLayerProps = {
  id: string;
  /** The headless cosmos.gl instance whose position texture to sample. */
  graph: Graph;
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

  declare public state: { model?: Model }

  public initializeState (): void {
    this.state = {}
  }

  public draw (): void {
    const positionInfo = this.props.graph.getPointPositionTexture()
    if (!positionInfo) return

    this.state.model ||= new Model(this.context.device, {
      id: `${this.props.id}-model`,
      vs: pointsVs,
      fs: pointsFs,
      topology: 'point-list',
      vertexCount: 0,
      uniforms: {},
      parameters: BLEND_PARAMETERS,
    })
    const { model } = this.state

    // Plain WebGL uniforms are read from `model.props.uniforms` on every draw
    Object.assign(model.props.uniforms, {
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

type CosmosLinksLayerProps = {
  id: string;
  /** The headless cosmos.gl instance whose position texture to sample. */
  graph: Graph;
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

  declare public state: { model?: Model; linksTexture?: Texture; linksTextureSize: number; linkCount: number }

  public initializeState (): void {
    this.state = { linksTextureSize: 0, linkCount: 0 }
  }

  public updateState (params: Parameters<Layer['updateState']>[0]): void {
    super.updateState(params)
    if (params.changeFlags.dataChanged || params.props.links !== params.oldProps.links) {
      this._createLinksTexture()
    }
  }

  public draw (): void {
    const positionInfo = this.props.graph.getPointPositionTexture()
    const { linksTexture, linksTextureSize, linkCount } = this.state
    if (!positionInfo || !linksTexture || linkCount === 0) return

    this.state.model ||= new Model(this.context.device, {
      id: `${this.props.id}-model`,
      vs: linksVs,
      fs: linksFs,
      topology: 'line-list',
      vertexCount: 0,
      uniforms: {},
      parameters: BLEND_PARAMETERS,
    })
    const { model } = this.state

    Object.assign(model.props.uniforms, {
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
