import { Layer, project32, picking, UNIT } from '@deck.gl/core'
import type { Accessor, Color, DefaultProps, LayerDataSource, LayerProps, Unit, UpdateParameters } from '@deck.gl/core'
import { Model, Geometry } from '@luma.gl/engine'

import { BLEND_PARAMETERS } from './blend-parameters'
import { cosmosPointsUniforms } from './cosmos-points-layer-uniforms'
import type { CosmosPointsProps } from './cosmos-points-layer-uniforms'
import type { PositionTextureSource } from './types'

const DEFAULT_POINT_COLOR: [number, number, number, number] = [74, 92, 191, 230]

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME cosmos-points-layer-vertex-shader

in vec3 positions;

in float instanceSizes;
in vec4 instanceColors;
in vec3 instancePickingColors;

uniform sampler2D positionsTexture;

out vec4 vColor;
out vec2 unitPosition;
out float outerRadiusPixels;

void main(void) {
  int pointIndex = gl_InstanceID;
  int textureSize = int(cosmosPoints.pointsTextureSize);
  // Point i lives at texel (i % size, i / size) as [x, y, i, unused] in space coordinates
  vec4 pointPosition = texelFetch(positionsTexture, ivec2(pointIndex % textureSize, pointIndex / textureSize), 0);

  // An absent point keeps a frozen NaN state; collapse its quad so it clips away
  if (isnan(pointPosition.x)) {
    gl_Position = vec4(0.0);
    unitPosition = vec2(0.0);
    outerRadiusPixels = 0.0;
    vColor = vec4(0.0);
    return;
  }

  geometry.worldPosition = vec3(pointPosition.xy, 0.0);
  geometry.pickingColor = instancePickingColors;

  // instanceSizes is a diameter; the quad expands by radius
  outerRadiusPixels = project_size_to_pixel(instanceSizes * 0.5, cosmosPoints.sizeUnits);
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
#define SHADER_NAME cosmos-points-layer-fragment-shader

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

export type CosmosPointsLayerProps<DataT = unknown> = CosmosPointsLayerOwnProps<DataT> & LayerProps

type CosmosPointsLayerOwnProps<DataT> = {
  /**
   * One entry per simulation point, in point-index order: an array to run
   * accessors over, or `{ length }` when accessors are constants. The length
   * must equal the simulation's point count.
   */
  data: LayerDataSource<DataT>;
  /** The simulation whose live position texture to sample. */
  graph: PositionTextureSource;
  /**
   * Point diameter accessor, in `pointSizeUnits`.
   * @default 4
   */
  getPointSize?: Accessor<DataT, number>;
  /**
   * Point RGBA color accessor, channels in 0..255.
   * @default [74, 92, 191, 230]
   */
  getPointColor?: Accessor<DataT, Color>;
  /**
   * The units of the point diameter, one of `'meters'`, `'common'`, `'pixels'`.
   * @default 'pixels'
   */
  pointSizeUnits?: Unit;
}

const defaultProps: DefaultProps<CosmosPointsLayerProps> = {
  getPointSize: { type: 'accessor', value: 4 },
  getPointColor: { type: 'accessor', value: DEFAULT_POINT_COLOR },
  pointSizeUnits: 'pixels',
  parameters: { type: 'object', value: BLEND_PARAMETERS, optional: true, compare: 2 },
}

/**
 * Renders every cosmos.gl point as an instanced quad whose position comes from
 * a `texelFetch` on the simulation's live GPU position texture — no position
 * attribute, no CPU copy, no per-frame attribute updates. Color and size are
 * ordinary deck instanced attributes, and picking works out of the box: the
 * instance index is the point index.
 */
export class CosmosPointsLayer<DataT = unknown> extends Layer<Required<CosmosPointsLayerOwnProps<DataT>>> {
  public static layerName = 'CosmosPointsLayer'
  public static defaultProps = defaultProps

  declare public state: { model?: Model }

  public getShaders (): ReturnType<Layer['getShaders']> {
    return super.getShaders({ vs, fs, modules: [project32, picking, cosmosPointsUniforms] })
  }

  public initializeState (): void {
    this.getAttributeManager()!.addInstanced({
      instanceSizes: {
        size: 1,
        transition: true,
        accessor: 'getPointSize',
        defaultValue: 4,
      },
      instanceColors: {
        size: 4,
        transition: true,
        type: 'unorm8',
        accessor: 'getPointColor',
        defaultValue: [...DEFAULT_POINT_COLOR],
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

    const moduleProps: CosmosPointsProps = {
      pointsTextureSize: positionInfo.textureSize,
      sizeUnits: UNIT[this.props.pointSizeUnits],
      positionsTexture: positionInfo.texture,
    }
    model.shaderInputs.setProps({ cosmosPoints: moduleProps })
    model.draw(this.context.renderPass)
  }

  private _getModel (): Model {
    // A quad that minimally covers the unit circle
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: {
          positions: { size: 3, value: new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]) },
        },
      }),
      isInstanced: true,
    })
  }
}
