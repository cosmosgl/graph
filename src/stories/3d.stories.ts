import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { basic3D } from './3d/basic'

import basic3DStoryRaw from './3d/basic/index?raw'
import basic3DStoryDataGenRaw from './3d/basic/data-gen?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/3D',
}

export const Basic3D: Story = {
  ...createStory(basic3D),
  name: 'Basic 3D Rendering',
  parameters: {
    sourceCode: [
      { name: 'Story', code: basic3DStoryRaw },
      { name: 'data-gen.ts', code: basic3DStoryDataGenRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
