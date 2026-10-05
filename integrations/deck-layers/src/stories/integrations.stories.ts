import type { Meta } from '@storybook/html'

import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import generateMeshDataRaw from '@/graph/stories/generate-mesh-data?raw'
import cosmosPointsLayerRaw from '../cosmos-points-layer?raw'
import cosmosLinksLayerRaw from '../cosmos-links-layer?raw'
import { graphLayer } from './graph-layer'
import { bigGraph } from './big-graph'
import { ownSimulations } from './own-simulations'
import { graphOnMap } from './graph-on-map'

import graphLayerRaw from './graph-layer?raw'
import bigGraphRaw from './big-graph?raw'
import ownSimulationsRaw from './own-simulations?raw'
import graphOnMapRaw from './graph-on-map?raw'
import styleRaw from './style.css?raw'

// Embedding cosmos.gl in deck.gl with `CosmosGraphLayer` from
// @cosmos.gl/deck-layers: the layer the deck.gl way, the layer at scale on
// cosmos.gl's flat arrays, the application owning the simulations, and the
// layer on a map. The big-graph story carries the internal sublayer sources
// as panes — a reference for sampling the position texture from a renderer
// of your own.
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Integrations',
  parameters: {
    controls: {
      disable: true,
    },
  },
}

export const GraphLayer: Story = {
  ...createStory(graphLayer),
  name: 'Graph layer',
  tags: ['beginner', 'interactive', 'labels'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: graphLayerRaw },
      { name: 'style.css', code: styleRaw },
    ],
  },
}

export const BigGraph: Story = {
  ...createStory(bigGraph),
  name: 'Big graph',
  tags: ['advanced', 'perf', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: bigGraphRaw },
      { name: 'style.css', code: styleRaw },
      { name: 'CosmosPointsLayer', code: cosmosPointsLayerRaw },
      { name: 'CosmosLinksLayer', code: cosmosLinksLayerRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

export const OwnSimulations: Story = {
  ...createStory(ownSimulations),
  name: 'Your own simulations',
  tags: ['advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: ownSimulationsRaw },
      { name: 'style.css', code: styleRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

export const GraphOnMap: Story = {
  ...createStory(graphOnMap),
  name: 'Graph on a map',
  tags: ['advanced', 'interactive', 'labels'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: graphOnMapRaw },
      { name: 'style.css', code: styleRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
