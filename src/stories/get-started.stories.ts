import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { quickStart } from './get-started/quick-start'
import { manualStep } from './get-started/manual-step'
import { actions } from './get-started/actions'

import quickStartStoryRaw from './get-started/quick-start?raw'
import manualStepRaw from './get-started/manual-step?raw'
import manualStepFixtureRaw from './get-started/manual-step-fixture?raw'
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

export const ManualStep: Story = {
  ...createStory(manualStep),
  name: 'Manual step',
  tags: ['beginner', 'interactive'],
  parameters: {
    sourceCode: [{ name: 'Story', code: manualStepRaw }, { name: 'Fixture', code: manualStepFixtureRaw }],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
