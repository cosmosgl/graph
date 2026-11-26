import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { quickStart } from './get-started/quick-start'
import { actions } from './get-started/actions'

import quickStartStoryRaw from './get-started/quick-start?raw'
import actionsStoryRaw from './get-started/actions/index?raw'
import actionsCssRaw from './get-started/actions/style.css?raw'
import actionsDataGenRaw from './get-started/actions/data-gen?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Get Started',
}

export const QuickStart: Story = {
  ...createStory(quickStart),
  name: 'Quick Start',
  tags: ['beginner'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: quickStartStoryRaw },
    ],
  },
}

export const Actions: Story = {
  ...createStory(actions),
  tags: ['beginner', 'interactive', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: actionsStoryRaw },
      { name: 'style.css', code: actionsCssRaw },
      { name: 'data-gen', code: actionsDataGenRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
