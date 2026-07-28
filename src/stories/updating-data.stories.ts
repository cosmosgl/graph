import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { addRemovePoints } from './updating-data/add-remove-points'
import { imageTransition } from './updating-data/image-transition'
import { citiesTransition } from './updating-data/cities-transition'

import addRemovePointsStoryRaw from './updating-data/add-remove-points/index?raw'
import addRemovePointsConfigRaw from './updating-data/add-remove-points/config?raw'
import addRemovePointsCssRaw from './updating-data/add-remove-points/style.css?raw'
import imageTransitionRaw from './updating-data/image-transition?raw'
import citiesTransitionRaw from './updating-data/cities-transition?raw'
import transitionCssRaw from './updating-data/transition.css?raw'
import pointDataRaw from './updating-data/point-data?raw'
import transitionHelpersRaw from './updating-data/transition-helpers?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Updating Data',
}

export const AddRemovePoints: Story = {
  ...createStory(addRemovePoints),
  name: 'Add & Remove Points',
  tags: ['advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: addRemovePointsStoryRaw },
      { name: 'config.ts', code: addRemovePointsConfigRaw },
      { name: 'style.css', code: addRemovePointsCssRaw },
    ],
  },
}

export const ImageTransition: Story = {
  ...createStory(imageTransition),
  name: 'Position Transition (image)',
  tags: ['large-data', 'interactive'],
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
  name: 'Layout Morph (cities)',
  tags: ['interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: citiesTransitionRaw },
      { name: 'transition.css', code: transitionCssRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
