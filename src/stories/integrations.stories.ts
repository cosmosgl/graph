import type { Meta } from '@storybook/html'

import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import { deckGlReadback } from './integrations/deck-gl-readback'
import { deckGlZeroCopy } from './integrations/deck-gl-zero-copy'
import { deckGlCosmosRendering } from './integrations/deck-gl-cosmos-rendering'

import deckGlReadbackRaw from './integrations/deck-gl-readback?raw'
import deckGlZeroCopyRaw from './integrations/deck-gl-zero-copy?raw'
import deckGlCosmosRenderingRaw from './integrations/deck-gl-cosmos-rendering?raw'
import cosmosDeckLayersRaw from './integrations/cosmos-deck-layers?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'

// Embedding cosmos.gl in host rendering frameworks. Both stories run cosmos.gl
// headless (`new Graph(null, …)`): no canvas of its own, no internal render
// loop — the host drives the simulation and renders the result.
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
      { name: 'Layers', code: cosmosDeckLayersRaw },
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
