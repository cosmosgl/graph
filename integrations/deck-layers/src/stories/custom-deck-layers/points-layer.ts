import { Layer, project32, picking, UNIT } from '@deck.gl/core'
import type { Accessor, Color, DefaultProps, LayerDataSource, LayerProps, Unit, UpdateParameters } from '@deck.gl/core'
import { Model, Geometry } from '@luma.gl/engine'

import { BLEND_PARAMETERS } from './blend-parameters'
import { pointsLayerUniforms, pointsShaders, drawPoints, type PositionSource } from './points-layer-uniforms'

const DEFAULT_POINT_COLOR: [number, number, number, number] = [74, 92, 191, 230]

export type PointsLayerProps<DataT = unknown> = PointsLayerOwnProps<DataT> & LayerProps

type PointsLayerOwnProps<DataT> = {
  /**
   * One entry per simulation point, in point-index order: an array to run
   * accessors over, or `{ length }` when accessors are constants. The length
   * must equal the simulation's point count.
   */
  data: LayerDataSource<DataT>;
  /**
   * Where point positions come from: a `GraphSimulation` or a `Graph`.
   * The layer reads them from its live GPU positions on every draw.
   */
  positionSource: PositionSource;
  /**
   * Point diameter accessor, in `pointSizeUnits`; `0` hides the point.
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

const defaultProps: DefaultProps<PointsLayerProps> = {
  getPointSize: { type: 'accessor', value: 4 },
  getPointColor: { type: 'accessor', value: DEFAULT_POINT_COLOR },
  pointSizeUnits: 'pixels',
  parameters: { type: 'object', value: BLEND_PARAMETERS, optional: true, compare: 2 },
}

/**
 * Renders every cosmos.gl point as an instanced quad whose position comes from
 * a vertex shader lookup in the simulation's live GPU positions — no position
 * attribute, no CPU copy, no per-frame attribute updates. Color and size are
 * ordinary deck instanced attributes, and picking works out of the box: the
 * instance index is the point index.
 *
 * Story code, not a package export: an example of a renderer of your own over
 * cosmos.gl's positions, with deck's picking, highlight and transitions.
 */
export class PointsLayer<DataT = unknown> extends Layer<Required<PointsLayerOwnProps<DataT>>> {
  public static layerName = 'PointsLayer'
  public static defaultProps = defaultProps

  declare public state: { model?: Model }

  public getShaders (): ReturnType<Layer['getShaders']> {
    return super.getShaders({ ...pointsShaders, modules: [project32, picking, pointsLayerUniforms] })
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
    const { model } = this.state
    if (model) drawPoints(model, this.props.positionSource, UNIT[this.props.pointSizeUnits], this.context.renderPass)
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
