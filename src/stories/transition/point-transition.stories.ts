import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { pointTransition } from './point-transition'

// @ts-expect-error Vite raw imports are resolved by Storybook at runtime.
import pointTransitionRaw from './point-transition?raw'
// @ts-expect-error Vite raw imports are resolved by Storybook at runtime.
import transitionCssRaw from './transition.css?raw'
// @ts-expect-error Vite raw imports are resolved by Storybook at runtime.
import pointDataRaw from './point-data?raw'
// @ts-expect-error Vite raw imports are resolved by Storybook at runtime.
import transitionHelpersRaw from './transition-helpers?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Beginners',
}

export const PointTransition: Story = {
  ...createStory(pointTransition),
  parameters: {
    sourceCode: [
      { name: 'Story', code: pointTransitionRaw },
      { name: 'transition.css', code: transitionCssRaw },
      { name: 'point-data.ts', code: pointDataRaw },
      { name: 'transition-helpers.ts', code: transitionHelpersRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
