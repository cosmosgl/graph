import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { antiAliasing } from './rendering/anti-aliasing'

import antiAliasingStoryRaw from './rendering/anti-aliasing/index?raw'

// How things come out on screen: edges, pixel ratios, blending. These are
// checks to look at rather than features to copy.
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Rendering',
}

export const AntiAliasing: Story = {
  ...createStory(antiAliasing),
  name: 'Edge Anti-aliasing at 0.5×, 1×, 2×',
  tags: ['advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: antiAliasingStoryRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
