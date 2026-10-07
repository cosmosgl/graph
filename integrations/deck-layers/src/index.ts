/**
 * A deck.gl layer that runs and draws a cosmos.gl graph. The simulation runs
 * on deck.gl's own luma.gl device, and cosmos.gl's own renderer draws it into
 * deck's render pass under deck's camera — positions never leave the GPU, and
 * every cosmos.gl rendering option is available through `config`.
 */
export {
  CosmosGraphLayer,
  DECK_OWNED_CONFIG_KEYS,
  type CosmosGraphLayerProps,
  type CosmosGraphLayerConfig,
  type CosmosGraphPoints,
  type CosmosPointAttributes,
  type CosmosGraphLinks,
  type CosmosLinkAttributes,
  type CosmosGraphDataLoadedInfo,
} from './cosmos-graph-layer'
