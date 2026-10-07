import { Layer, project32, picking, UNIT } from '@deck.gl/core'
import type { Accessor, Color, DefaultProps, LayerDataSource, LayerProps, Unit, UpdateParameters } from '@deck.gl/core'
import { Model, Geometry } from '@luma.gl/engine'
import type { PositionTextureSource } from '@cosmos.gl/graph'

import { BLEND_PARAMETERS } from './blend-parameters'
import { cosmosLinksUniforms } from './cosmos-links-layer-uniforms'
import type { CosmosLinksProps } from './cosmos-links-layer-uniforms'

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

// The engine's isPointIndex: an integer in [0, pointCount). A fraction would
// truncate to a neighbour, NaN would make int() undefined.
bool namesPoint(float index, float pointCount) {
  return index >= 0.0 && index < pointCount && index == floor(index);
}

vec4 fetchPointPosition(float index, int textureSize) {
  int pointIndex = int(index);
  // Point i lives at texel (i % size, i / size) as [x, y, i, unused] in space coordinates
  return texelFetch(positionsTexture, ivec2(pointIndex % textureSize, pointIndex / textureSize), 0);
}

// The engine's curve: a rational quadratic Bézier from a to b, pulled toward the
// control point c by the weight w. With c on the chord it is the straight link.
vec3 linkCurve(vec2 a, vec2 b, vec2 c, float t, float w) {
  float s = 1.0 - t;
  vec2 dividend = s * s * a + 2.0 * s * t * w * c + t * t * b;
  float divisor = s * s + 2.0 * s * t * w + t * t;
  return vec3(dividend / divisor, 0.0);
}

void main(void) {
  // An endpoint that names no point (an index outside the point count) is
  // skipped, never dropped, so the instance index stays the link index — the
  // rule the engine applies to the same pair in its link grouping. Its texel
  // would be outside the live data.
  float pointCount = cosmosLinks.pointCount;
  bool namesNoPoint = !namesPoint(instanceSourceIndices, pointCount) || !namesPoint(instanceTargetIndices, pointCount);

  int textureSize = int(cosmosLinks.pointsTextureSize);
  vec4 sourcePosition = namesNoPoint ? vec4(0.0) : fetchPointPosition(instanceSourceIndices, textureSize);
  vec4 targetPosition = namesNoPoint ? vec4(0.0) : fetchPointPosition(instanceTargetIndices, textureSize);

  // A removed (absent) endpoint's texel is NaN — see PointPositionTexture;
  // collapse the quad, as for an endpoint that names no point, so it clips away
  if (namesNoPoint || isnan(sourcePosition.x) || isnan(targetPosition.x)) {
    gl_Position = vec4(0.0);
    vColor = vec4(0.0);
    uv = vec2(0.0);
    return;
  }

  vec2 a = sourcePosition.xy;
  vec2 b = targetPosition.xy;
  geometry.worldPosition = vec3(a, 0.0);
  geometry.worldPositionAlt = vec3(b, 0.0);

  // The control point sits on the chord's normal (as long as the chord) at
  // controlPointDistance link lengths from the midpoint; 0 keeps the link straight
  vec2 chord = b - a;
  vec2 control = (a + b) / 2.0 + vec2(-chord.y, chord.x) * cosmosLinks.controlPointDistance;
  float w = cosmosLinks.curveWeight;

  // positions.x is the parameter along the link, positions.y the extrusion side
  float t = positions.x;
  float dt = 1.0 / cosmosLinks.curveSegments;
  vec4 commonspace;
  vec4 p = project_position_to_clipspace(linkCurve(a, b, control, t, w), vec3(0.0), vec3(0.0), commonspace);
  // The tangent from the neighbouring samples, clamped to the ends, so the
  // ribbon keeps its width around the bend
  vec4 behind = project_position_to_clipspace(linkCurve(a, b, control, max(t - dt, 0.0), w), vec3(0.0), vec3(0.0));
  vec4 ahead = project_position_to_clipspace(linkCurve(a, b, control, min(t + dt, 1.0), w), vec3(0.0), vec3(0.0));
  geometry.position = commonspace;
  uv = positions.xy;
  geometry.uv = uv;
  geometry.pickingColor = instancePickingColors;

  float widthPixels = project_size_to_pixel(instanceWidths, cosmosLinks.widthUnits);

  vec3 offset = vec3(getExtrusionOffset(ahead.xy - behind.xy, positions.y, widthPixels), 0.0);
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
  /** Draws links as curves. @default false */
  curvedLinks?: boolean;
  /** Number of segments in a curved link. @default 19 */
  curvedLinkSegments?: number;
  /** The weight of the curve's control point. @default 0.8 */
  curvedLinkWeight?: number;
  /** The control point's distance from the link's midpoint, in link lengths. @default 0.5 */
  curvedLinkControlPointDistance?: number;
}

const defaultProps: DefaultProps<CosmosLinksLayerProps> = {
  getLinkSource: { type: 'accessor', value: (l: unknown) => (l as { source: number }).source },
  getLinkTarget: { type: 'accessor', value: (l: unknown) => (l as { target: number }).target },
  getLinkColor: { type: 'accessor', value: DEFAULT_LINK_COLOR },
  getLinkWidth: { type: 'accessor', value: 1 },
  linkWidthUnits: 'pixels',
  curvedLinks: false,
  curvedLinkSegments: { type: 'number', value: 19, min: 1 },
  curvedLinkWeight: 0.8,
  curvedLinkControlPointDistance: 0.5,
  parameters: { type: 'object', value: BLEND_PARAMETERS, optional: true, compare: 2 },
}

/**
 * A triangle strip of `segments` quads along the link: x is the curve
 * parameter (0 at the source, 1 at the target), y the extrusion side.
 */
const linkStripPositions = (segments: number): Float32Array => {
  const positions = new Float32Array((segments + 1) * 2 * 3)
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    positions.set([t, -1, 0, t, 1, 0], i * 6)
  }
  return positions
}

/**
 * Renders every cosmos.gl link as an instanced quad stretched between its two
 * endpoints — or, curved, a strip of quads along the engine's curve: the vertex
 * shader `texelFetch`es both point positions from the simulation's live GPU
 * texture and extrudes the quad by half the link width in screen space — no
 * position attribute, no CPU copy, no per-frame attribute updates. Endpoint indices, color and width are ordinary deck instanced
 * attributes, and picking works out of the box: the instance index is the
 * link index.
 *
 * Internal: the links sublayer of `CosmosGraphLayer`, not a package export —
 * the composite resolves array links to point indices before they reach this
 * layer, and a pair that names no point collapses in the shader, keeping its
 * index.
 */
export class CosmosLinksLayer<DataT = unknown> extends Layer<Required<CosmosLinksLayerOwnProps<DataT>>> {
  public static layerName = 'CosmosLinksLayer'
  public static defaultProps = defaultProps

  declare public state: { model?: Model; segments?: number }

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

    // A straight link is one quad; a curve needs a strip of them
    const { curvedLinks, curvedLinkSegments } = params.props
    const segments = curvedLinks ? Math.max(1, Math.round(curvedLinkSegments)) : 1
    if (params.changeFlags.extensionsChanged || segments !== this.state.segments) {
      this.state.model?.destroy()
      this.state.segments = segments
      this.state.model = this._getModel(segments)
      // The new model has none of the instanced buffers yet
      this.getAttributeManager()!.invalidateAll()
    }
  }

  public draw (): void {
    const positionInfo = this.props.graph.getPointPositionTexture()
    const { model } = this.state
    if (!positionInfo || !model || positionInfo.pointCount === 0) return

    const { curvedLinks, curvedLinkWeight, curvedLinkControlPointDistance } = this.props
    const moduleProps: CosmosLinksProps = {
      pointsTextureSize: positionInfo.textureSize,
      widthUnits: UNIT[this.props.linkWidthUnits],
      pointCount: positionInfo.pointCount,
      controlPointDistance: curvedLinks ? curvedLinkControlPointDistance : 0,
      curveWeight: curvedLinkWeight,
      curveSegments: this.state.segments ?? 1,
      positionsTexture: positionInfo.texture,
    }
    model.shaderInputs.setProps({ cosmosLinks: moduleProps })
    model.draw(this.context.renderPass)
  }

  private _getModel (segments: number): Model {
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: {
          positions: { size: 3, value: linkStripPositions(segments) },
        },
      }),
      isInstanced: true,
    })
  }
}
