import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { strokeStyles } from './link-styles/stroke-styles'
import { gradientLinks } from './link-styles/gradient-links'
import { interactiveLinkStyles } from './link-styles/interactive'

import strokeStylesStoryRaw from './link-styles/stroke-styles/index?raw'
import gradientLinksStoryRaw from './link-styles/gradient-links/index?raw'
import interactiveStoryRaw from './link-styles/interactive/index?raw'

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Link Styles',
}

export const StrokeStyles: Story = {
  ...createStory(strokeStyles),
  name: 'Solid / Dashed / Dotted',
  parameters: {
    sourceCode: [
      { name: 'Story', code: strokeStylesStoryRaw },
    ],
  },
}

export const GradientLinks: Story = {
  ...createStory(gradientLinks),
  name: 'Gradient Links',
  parameters: {
    sourceCode: [
      { name: 'Story', code: gradientLinksStoryRaw },
    ],
  },
}

export const InteractivePlayground: Story = {
  ...createStory(interactiveLinkStyles),
  name: 'Interactive Playground (big graph)',
  parameters: {
    sourceCode: [
      { name: 'Story', code: interactiveStoryRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
