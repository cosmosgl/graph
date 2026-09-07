/**
 * deck.gl layers that render a cosmos.gl simulation with **zero position
 * readback**: each draw samples the live GPU position texture exposed by
 * `graph.getPointPositionTexture()` with `texelFetch`, so point coordinates
 * never leave the GPU. The layers share deck.gl's device with the cosmos.gl
 * simulation, which the application owns and steps.
 */
export {
  CosmosGraphLayer,
  type CosmosGraphLayerProps,
  type CosmosGraphPoints,
  type CosmosGraphLinks,
  type CosmosGraphPickingInfo,
} from './cosmos-graph-layer'
export { CosmosPointsLayer, type CosmosPointsLayerProps } from './cosmos-points-layer'
export { CosmosLinksLayer, type CosmosLinksLayerProps } from './cosmos-links-layer'
export type { PositionTextureSource } from './types'
