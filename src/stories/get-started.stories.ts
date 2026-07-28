import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { quickStart } from './get-started/quick-start'
import { moscowMetroStations } from './get-started/position-rescaling'

import quickStartStoryRaw from './get-started/quick-start?raw'
import positionRescalingStoryRaw from './get-started/position-rescaling/index?raw'
import positionRescalingCoordsRaw from './get-started/position-rescaling/moscow-metro-coords?raw'
import positionRescalingColorsRaw from './get-started/position-rescaling/point-colors?raw'
import positionRescalingCssRaw from './get-started/position-rescaling/style.css?raw'

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

export const PositionRescaling: Story = {
  ...createStory(moscowMetroStations),
  name: 'Position Rescaling',
  tags: ['beginner', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: positionRescalingStoryRaw },
      { name: 'moscow-metro-coords', code: positionRescalingCoordsRaw },
      { name: 'point-colors', code: positionRescalingColorsRaw },
      { name: 'style.css', code: positionRescalingCssRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
