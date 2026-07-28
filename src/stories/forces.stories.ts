import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { collision } from './forces/collision'

import createCosmosRaw from './create-cosmos?raw'
import collisionRaw from './forces/collision?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Forces',
}

export const Collision: Story = {
  ...createStory(collision),
  tags: ['beginner'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: collisionRaw },
      { name: 'create-cosmos', code: createCosmosRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
