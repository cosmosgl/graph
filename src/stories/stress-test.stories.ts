import type { Meta } from '@storybook/html'

import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import { hyperbolicStressTest } from './stress-test'

import hyperbolicStressTestStoryRaw from './stress-test/index?raw'
import hyperbolicUtilsRaw from './utils?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Stress Test',
  parameters: {
    controls: {
      disable: true,
    },
  },
}

export const HyperbolicLargeGraph: Story = {
  ...createStory(hyperbolicStressTest),
  name: 'Hyperbolic Graph (140k points, ~1M links)',
  parameters: {
    sourceCode: [
      { name: 'Story', code: hyperbolicStressTestStoryRaw },
      { name: 'Generator', code: hyperbolicUtilsRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
