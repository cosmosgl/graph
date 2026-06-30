import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { imageTransition } from './image-transition'
import { citiesTransition } from './cities-transition'

// @ts-expect-error Vite raw imports are resolved by Storybook at runtime.
import imageTransitionRaw from './image-transition?raw'
// @ts-expect-error Vite raw imports are resolved by Storybook at runtime.
import transitionCssRaw from './transition.css?raw'
// @ts-expect-error Vite raw imports are resolved by Storybook at runtime.
import pointDataRaw from './point-data?raw'
// @ts-expect-error Vite raw imports are resolved by Storybook at runtime.
import transitionHelpersRaw from './transition-helpers?raw'
// @ts-expect-error Vite raw imports are resolved by Storybook at runtime.
import citiesTransitionRaw from './cities-transition?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Transitions',
}

export const ImageTransition: Story = {
  ...createStory(imageTransition),
  parameters: {
    sourceCode: [
      { name: 'Story', code: imageTransitionRaw },
      { name: 'transition.css', code: transitionCssRaw },
      { name: 'point-data.ts', code: pointDataRaw },
      { name: 'transition-helpers.ts', code: transitionHelpersRaw },
    ],
  },
}

export const CitiesTransition: Story = {
  ...createStory(citiesTransition),
  parameters: {
    sourceCode: [
      { name: 'Story', code: citiesTransitionRaw },
      { name: 'transition.css', code: transitionCssRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
