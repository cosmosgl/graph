import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { repulsionBenchmark } from './misc/repulsion-benchmark'

import repulsionBenchmarkRaw from './misc/repulsion-benchmark?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Misc',
}

export const RepulsionBenchmark: Story = {
  ...createStory(repulsionBenchmark),
  parameters: {
    sourceCode: [
      { name: 'Story', code: repulsionBenchmarkRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
