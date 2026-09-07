import type { Meta } from '@storybook/html'

import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import generateMeshDataRaw from '@/graph/stories/generate-mesh-data?raw'
import cosmosPointsLayerRaw from '../cosmos-points-layer?raw'
import cosmosLinksLayerRaw from '../cosmos-links-layer?raw'
import blendParametersRaw from '../blend-parameters?raw'
import { deckGlZeroCopy } from './deck-gl-zero-copy'
import { cosmosGraphObjects } from './cosmos-graph-objects'

import deckGlZeroCopyRaw from './deck-gl-zero-copy?raw'
import cosmosGraphObjectsRaw from './cosmos-graph-objects?raw'

// Embedding cosmos.gl in deck.gl with `CosmosGraphLayer` from
// @cosmos.gl/deck-layers — the layer owns the simulation, steps it from
// deck's timeline, and exposes picking and drag-to-pin. The flagship's panes
// carry the primitive-layer sources for advanced composition.
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Integrations',
  parameters: {
    controls: {
      disable: true,
    },
  },
}

export const CosmosGraphZeroCopy: Story = {
  ...createStory(deckGlZeroCopy),
  name: 'CosmosGraphLayer: zero-copy graph (10k points)',
  tags: ['advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: deckGlZeroCopyRaw },
      { name: 'CosmosPointsLayer', code: cosmosPointsLayerRaw },
      { name: 'CosmosLinksLayer', code: cosmosLinksLayerRaw },
      { name: 'blend-parameters', code: blendParametersRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

export const CosmosGraphObjectData: Story = {
  ...createStory(cosmosGraphObjects),
  name: 'CosmosGraphLayer: object data and accessors',
  tags: ['beginner', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: cosmosGraphObjectsRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
