import type { Meta } from '@storybook/html'

import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import cosmosPointsLayerRaw from '../../integrations/deck-layers/src/cosmos-points-layer?raw'
import cosmosLinksLayerRaw from '../../integrations/deck-layers/src/cosmos-links-layer?raw'
import { deckGlReadback } from './integrations/deck-gl-readback'
import { deckGlZeroCopy } from './integrations/deck-gl-zero-copy'
import { deckGlCosmosRendering } from './integrations/deck-gl-cosmos-rendering'

import deckGlReadbackRaw from './integrations/deck-gl-readback?raw'
import deckGlZeroCopyRaw from './integrations/deck-gl-zero-copy?raw'
import deckGlCosmosRenderingRaw from './integrations/deck-gl-cosmos-rendering?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'

// Embedding cosmos.gl in host rendering frameworks. Every story runs the
// simulation without a canvas of its own or an internal render loop — the host
// drives it and renders the result. The zero-copy story uses the standalone
// `GraphSimulation` class; the others run a headless `Graph`
// (`new Graph(null, …)`), which composes the same simulation.
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Integrations',
  parameters: {
    controls: {
      disable: true,
    },
  },
}

export const DeckGlZeroCopy: Story = {
  ...createStory(deckGlZeroCopy),
  name: 'deck.gl: shared device, zero-copy (10k points)',
  tags: ['advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: deckGlZeroCopyRaw },
      { name: 'CosmosPointsLayer', code: cosmosPointsLayerRaw },
      { name: 'CosmosLinksLayer', code: cosmosLinksLayerRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

export const DeckGlCosmosRendering: Story = {
  ...createStory(deckGlCosmosRendering),
  name: 'deck.gl: cosmos rendering in a deck layer (10k points)',
  tags: ['advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: deckGlCosmosRenderingRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

export const DeckGlReadback: Story = {
  ...createStory(deckGlReadback),
  name: 'deck.gl: CPU readback layout (2k points)',
  tags: ['advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: deckGlReadbackRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
