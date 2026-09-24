/**
 * A deck.gl layer that renders a cosmos.gl simulation with **zero position
 * readback**: each draw samples the live GPU position texture with
 * `texelFetch`, so point coordinates never leave the GPU. The simulation runs
 * on deck.gl's own device — created and owned by the layer, or supplied by the
 * application through the `simulation` prop.
 */
export {
  CosmosGraphLayer,
  type CosmosGraphLayerProps,
  type CosmosGraphPoints,
  type CosmosGraphLinks,
  type CosmosGraphPickingInfo,
} from './cosmos-graph-layer'
