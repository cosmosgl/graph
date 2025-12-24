import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { testLumaMigration } from './test-luma-migration'

import testLumaMigrationRaw from './test-luma-migration?raw'

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta: Meta<CosmosStoryProps> = {
  title: 'Tests/Luma Migration',
}

export const TestLumaMigration: Story = {
  ...createStory(testLumaMigration),
  name: 'Test Luma.gl Migration',
  parameters: {
    sourceCode: [
      { name: 'Story', code: testLumaMigrationRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
