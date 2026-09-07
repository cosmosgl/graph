import { Layer, project32, picking, UNIT } from '@deck.gl/core'
import type { Accessor, Color, DefaultProps, LayerDataSource, LayerProps, Unit, UpdateParameters } from '@deck.gl/core'
import { Model, Geometry } from '@luma.gl/engine'

import { BLEND_PARAMETERS } from './blend-parameters'
import { cosmosLinksUniforms } from './cosmos-links-layer-uniforms'
import type { CosmosLinksProps } from './cosmos-links-layer-uniforms'
import type { PositionTextureSource } from './types'

const DEFAULT_LINK_COLOR: [number, number, number, number] = [94, 115, 194, 64]

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME cosmos-links-layer-vertex-shader

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

vec4 fetchPointPosition(float index, int textureSize) {
  int pointIndex = int(index);
  // Point i lives at texel (i % size, i / size) as [x, y, i, unused] in space coordinates
  return texelFetch(positionsTexture, ivec2(pointIndex % textureSize, pointIndex / textureSize), 0);
}

void main(void) {
  int textureSize = int(cosmosLinks.pointsTextureSize);
  vec4 sourcePosition = fetchPointPosition(instanceSourceIndices, textureSize);
  vec4 targetPosition = fetchPointPosition(instanceTargetIndices, textureSize);

  // A removed (absent) endpoint's texel is NaN — see PointPositionTexture;
  // collapse the quad so it clips away
  if (isnan(sourcePosition.x) || isnan(targetPosition.x)) {
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

  float widthPixels = project_size_to_pixel(instanceWidths, cosmosLinks.widthUnits);

  vec3 offset = vec3(getExtrusionOffset(target.xy - source.xy, positions.y, widthPixels), 0.0);
  DECKGL_FILTER_SIZE(offset, geometry);
  DECKGL_FILTER_GL_POSITION(p, geometry);
  gl_Position = p + vec4(project_pixel_size_to_clipspace(offset.xy), 0.0, 0.0);

  vColor = vec4(instanceColors.rgb, instanceColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME cosmos-links-layer-fragment-shader

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

export type CosmosLinksLayerProps<DataT = unknown> = CosmosLinksLayerOwnProps<DataT> & LayerProps

type CosmosLinksLayerOwnProps<DataT> = {
  /**
   * One entry per link, in link-index order: an array to run accessors over,
   * or binary form. The cosmos links array `[src0, tgt0, src1, tgt1, …]` maps
   * without a copy as two interleaved attributes over the same buffer:
   * `{ length, attributes: { getLinkSource: { value, size: 1, stride: 8 },
   * getLinkTarget: { value, size: 1, offset: 4, stride: 8 } } }`.
   */
  data: LayerDataSource<DataT>;
  /** The simulation whose live position texture to sample. */
  graph: PositionTextureSource;
  /**
   * Source point index accessor.
   * @default l => l.source
   */
  getLinkSource?: Accessor<DataT, number>;
  /**
   * Target point index accessor.
   * @default l => l.target
   */
  getLinkTarget?: Accessor<DataT, number>;
  /**
   * Link RGBA color accessor, channels in 0..255.
   * @default [94, 115, 194, 64]
   */
  getLinkColor?: Accessor<DataT, Color>;
  /**
   * Link width accessor, in `linkWidthUnits`.
   * @default 1
   */
  getLinkWidth?: Accessor<DataT, number>;
  /**
   * The units of the link width, one of `'meters'`, `'common'`, `'pixels'`.
   * @default 'pixels'
   */
  linkWidthUnits?: Unit;
}

const defaultProps: DefaultProps<CosmosLinksLayerProps> = {
  getLinkSource: { type: 'accessor', value: (l: unknown) => (l as { source: number }).source },
  getLinkTarget: { type: 'accessor', value: (l: unknown) => (l as { target: number }).target },
  getLinkColor: { type: 'accessor', value: DEFAULT_LINK_COLOR },
  getLinkWidth: { type: 'accessor', value: 1 },
  linkWidthUnits: 'pixels',
  parameters: { type: 'object', value: BLEND_PARAMETERS, optional: true, compare: 2 },
}

/**
 * Renders every cosmos.gl link as an instanced quad stretched between its two
 * endpoints: the vertex shader `texelFetch`es both point positions from the
 * simulation's live GPU texture and extrudes the quad by half the link width
 * in screen space — no position attribute, no CPU copy, no per-frame attribute
 * updates. Endpoint indices, color and width are ordinary deck instanced
 * attributes, and picking works out of the box: the instance index is the
 * link index.
 */
export class CosmosLinksLayer<DataT = unknown> extends Layer<Required<CosmosLinksLayerOwnProps<DataT>>> {
  public static layerName = 'CosmosLinksLayer'
  public static defaultProps = defaultProps

  declare public state: { model?: Model }

  public getShaders (): ReturnType<Layer['getShaders']> {
    return super.getShaders({ vs, fs, modules: [project32, picking, cosmosLinksUniforms] })
  }

  public initializeState (): void {
    this.getAttributeManager()!.addInstanced({
      instanceSourceIndices: {
        size: 1,
        accessor: 'getLinkSource',
      },
      instanceTargetIndices: {
        size: 1,
        accessor: 'getLinkTarget',
      },
      instanceColors: {
        size: 4,
        transition: true,
        type: 'unorm8',
        accessor: 'getLinkColor',
        defaultValue: [...DEFAULT_LINK_COLOR],
      },
      instanceWidths: {
        size: 1,
        transition: true,
        accessor: 'getLinkWidth',
        defaultValue: 1,
      },
    })
  }

  public updateState (params: UpdateParameters<this>): void {
    super.updateState(params)

    if (params.changeFlags.extensionsChanged) {
      this.state.model?.destroy()
      this.state.model = this._getModel()
      this.getAttributeManager()!.invalidateAll()
    }
  }

  public draw (): void {
    const positionInfo = this.props.graph.getPointPositionTexture()
    const { model } = this.state
    if (!positionInfo || !model || positionInfo.pointCount === 0) return

    const moduleProps: CosmosLinksProps = {
      pointsTextureSize: positionInfo.textureSize,
      widthUnits: UNIT[this.props.linkWidthUnits],
      positionsTexture: positionInfo.texture,
    }
    model.shaderInputs.setProps({ cosmosLinks: moduleProps })
    model.draw(this.context.renderPass)
  }

  private _getModel (): Model {
    // positions.x selects source/target, positions.y the extrusion side
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: {
          positions: { size: 3, value: new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]) },
        },
      }),
      isInstanced: true,
    })
  }
}
