import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { allShapes } from './points/shapes'
import { imageExample } from './points/images'
import { pointLabels } from './points/labels'
import { worm } from './points/animated-colors'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import shapesStoryRaw from './points/shapes/index?raw'
import imagesStoryRaw from './points/images/index?raw'
import labelsStoryRaw from './points/labels/index?raw'
import labelsDataRaw from './points/labels/data?raw'
import labelsLabelsRaw from './points/labels/labels?raw'
import labelsCssRaw from './points/labels/style.css?raw'
import animatedColorsRaw from './points/animated-colors?raw'

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
      d.args.destroy?.()
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

export const AnimatedColors: Story = {
  ...createStory(worm),
  name: 'Animating Point Colors',
  tags: ['large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: animatedColorsRaw },
      { name: 'create-cosmos', code: createCosmosRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
