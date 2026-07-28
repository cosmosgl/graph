import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { strokeStyles } from './links/stroke-styles'
import { gradientLinks } from './links/gradient-links'
import { linkHovering } from './links/hovering'
import { linkSampling } from './links/labels'
import { interactiveLinkStyles } from './links/playground'

import strokeStylesStoryRaw from './links/stroke-styles/index?raw'
import gradientLinksStoryRaw from './links/gradient-links/index?raw'
import hoveringStoryRaw from './links/hovering/index?raw'
import hoveringDataGenRaw from './links/hovering/data-generator?raw'
import hoveringCssRaw from './links/hovering/style.css?raw'
import labelsStoryRaw from './links/labels/index?raw'
import labelsDataRaw from './links/labels/data?raw'
import labelsLabelsRaw from './links/labels/labels?raw'
import labelsCssRaw from './links/labels/style.css?raw'
import playgroundStoryRaw from './links/playground/index?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Links',
}

export const StrokeStyles: Story = {
  ...createStory(strokeStyles),
  name: 'Solid / Dashed / Dotted',
  tags: ['beginner'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: strokeStylesStoryRaw },
    ],
  },
}

export const GradientLinks: Story = {
  ...createStory(gradientLinks),
  name: 'Gradient Links',
  tags: ['beginner'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: gradientLinksStoryRaw },
    ],
  },
}

export const LinkHovering: Story = {
  ...createStory(linkHovering),
  name: 'Link Hovering',
  tags: ['beginner', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: hoveringStoryRaw },
      { name: 'data-generator.ts', code: hoveringDataGenRaw },
      { name: 'style.css', code: hoveringCssRaw },
    ],
  },
}

export const LinkLabels: Story = {
  ...createStory(linkSampling),
  name: 'Link Labels (sampling)',
  tags: ['labels'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: labelsStoryRaw },
      { name: 'labels.ts', code: labelsLabelsRaw },
      { name: 'data.ts', code: labelsDataRaw },
      { name: 'style.css', code: labelsCssRaw },
    ],
  },
}

export const LinkStylePlayground: Story = {
  ...createStory(interactiveLinkStyles),
  name: 'Link Style Playground',
  tags: ['interactive', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: playgroundStoryRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
