import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { allShapes } from './points/shapes'
import { imageExample } from './points/images'
import { pointLabels } from './points/labels'
import { moscowMetroStations } from './points/position-rescaling'

import shapesStoryRaw from './points/shapes/index?raw'
import imagesStoryRaw from './points/images/index?raw'
import labelsStoryRaw from './points/labels/index?raw'
import labelsDataRaw from './points/labels/data?raw'
import labelsLabelsRaw from './points/labels/labels?raw'
import labelsCssRaw from './points/labels/style.css?raw'
import rescalingStoryRaw from './points/position-rescaling/index?raw'
import rescalingCoordsRaw from './points/position-rescaling/moscow-metro-coords?raw'
import rescalingColorsRaw from './points/position-rescaling/point-colors?raw'
import rescalingCssRaw from './points/position-rescaling/style.css?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Points',
}

export const AllShapes: Story = {
  ...createStory(allShapes),
  name: 'All Point Shapes',
  tags: ['beginner'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: shapesStoryRaw },
    ],
  },
}

export const ImagePoints: Story = {
  ...createStory(imageExample),
  name: 'Image Points',
  tags: ['interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: imagesStoryRaw },
    ],
  },
}

export const PointLabels: Story = {
  name: 'Point Labels (tracking)',
  tags: ['labels'],
  loaders: [
    async (): Promise<{ data: { performances: [] } }> => {
      try {
        const response = await fetch('https://gist.githubusercontent.com/Stukova/e6c4c7777e0166431a983999213f10c8/raw/performances.json')
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`)
        }
        return {
          data: await response.json(),
        }
      } catch (error) {
        console.error('Failed to fetch data:', error)
        return {
          data: { performances: [] },
        }
      }
    },
  ],
  async beforeEach (d): Promise<() => void> {
    return (): void => {
      // Same teardown contract as createStory: `destroy` is extra cleanup,
      // and the graph must be destroyed even if it throws.
      try {
        d.args.destroy?.()
      } finally {
        d.args.graph?.destroy()
      }
    }
  },
  render: (args, { loaded: { data } }): HTMLDivElement => {
    const div = document.createElement('div')
    div.style.height = '100vh'
    div.style.width = '100%'

    try {
      const story = pointLabels(data.performances)
      args.graph = story.graph
      args.destroy = story.destroy
      div.appendChild(story.div)
    } catch (error) {
      console.error('Failed to load PointLabels story:', error)
      div.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #ff0000;">Failed to load story</div>'
    }

    return div
  },
  parameters: {
    sourceCode: [
      { name: 'Story', code: labelsStoryRaw },
      { name: 'data.ts', code: labelsDataRaw },
      { name: 'labels.ts', code: labelsLabelsRaw },
      { name: 'style.css', code: labelsCssRaw },
    ],
  },
}

export const PositionRescaling: Story = {
  ...createStory(moscowMetroStations),
  name: 'Position Rescaling',
  tags: ['beginner', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: rescalingStoryRaw },
      { name: 'moscow-metro-coords', code: rescalingCoordsRaw },
      { name: 'point-colors', code: rescalingColorsRaw },
      { name: 'style.css', code: rescalingCssRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
