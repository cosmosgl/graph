import { Layer, project32, picking, UNIT } from '@deck.gl/core'
import type { Accessor, Color, DefaultProps, LayerDataSource, LayerProps, Unit, UpdateParameters } from '@deck.gl/core'
import { Model, Geometry } from '@luma.gl/engine'

import { BLEND_PARAMETERS } from './blend-parameters'
import { linksLayerUniforms, linksShaders, drawLinks, type PositionSource } from './links-layer-uniforms'

const DEFAULT_LINK_COLOR: [number, number, number, number] = [94, 115, 194, 64]

export type LinksLayerProps<DataT = unknown> = LinksLayerOwnProps<DataT> & LayerProps

type LinksLayerOwnProps<DataT> = {
  /**
   * One entry per link, in link-index order: an array to run accessors over,
   * or binary form. The cosmos links array `[src0, tgt0, src1, tgt1, …]` maps
   * without a copy as two interleaved attributes over the same buffer:
   * `{ length, attributes: { getLinkSource: { value, size: 1, stride: 8 },
   * getLinkTarget: { value, size: 1, offset: 4, stride: 8 } } }`.
   */
  data: LayerDataSource<DataT>;
  /**
   * Where point positions come from: a `GraphSimulation` or a `Graph`.
   * The layer reads them from its live GPU positions on every draw.
   */
  positionSource: PositionSource;
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

const defaultProps: DefaultProps<LinksLayerProps> = {
  getLinkSource: { type: 'accessor', value: (l: unknown) => (l as { source: number }).source },
  getLinkTarget: { type: 'accessor', value: (l: unknown) => (l as { target: number }).target },
  getLinkColor: { type: 'accessor', value: DEFAULT_LINK_COLOR },
  getLinkWidth: { type: 'accessor', value: 1 },
  linkWidthUnits: 'pixels',
  parameters: { type: 'object', value: BLEND_PARAMETERS, optional: true, compare: 2 },
}

/**
 * Renders every cosmos.gl link as an instanced quad stretched between its two
 * endpoints. The vertex shader reads both positions from the simulation and
 * extrudes the quad by half the link width
 * in screen space — no position attribute, no CPU copy, no per-frame attribute
 * updates. Endpoint indices, color and width are ordinary deck instanced
 * attributes, and picking works out of the box: the instance index is the
 * link index.
 *
 * Story code, not a package export: an example of a renderer of your own over
 * cosmos.gl's positions. A pair that names no point collapses in the shader,
 * keeping its index.
 */
export class LinksLayer<DataT = unknown> extends Layer<Required<LinksLayerOwnProps<DataT>>> {
  public static layerName = 'LinksLayer'
  public static defaultProps = defaultProps

  declare public state: { model?: Model }

  public getShaders (): ReturnType<Layer['getShaders']> {
    return super.getShaders({ ...linksShaders, modules: [project32, picking, linksLayerUniforms] })
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
      // The new model has none of the instanced buffers yet
      this.getAttributeManager()!.invalidateAll()
    }
  }

  public draw (): void {
    const { model } = this.state
    if (model) drawLinks(model, this.props.positionSource, UNIT[this.props.linkWidthUnits], this.context.renderPass)
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
