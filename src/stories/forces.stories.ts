import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { collision } from './forces/collision'

import createCosmosRaw from './create-cosmos?raw'
import collisionRaw from './forces/collision?raw'

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Forces',
}

const sourceCodeAddonParams = [
  { name: 'create-cosmos', code: createCosmosRaw },
]

export const Collision: Story = {
  ...createStory(collision),
  parameters: {
    sourceCode: [
      { name: 'Story', code: collisionRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
