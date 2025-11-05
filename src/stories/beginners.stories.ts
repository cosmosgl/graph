import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { quickStart } from './beginners/quick-start'
import { basicSetUp } from './beginners/basic-set-up'
import { pointLabels } from './beginners/point-labels'
import { removePoints } from './beginners/remove-points'
import { linkHovering } from './beginners/link-hovering'
import { pinnedPoints } from './beginners/pinned-points'

import quickStartStoryRaw from './beginners/quick-start?raw'
import basicSetUpStoryRaw from './beginners/basic-set-up/index?raw'
import basicSetUpStoryCssRaw from './beginners/basic-set-up/style.css?raw'
import basicSetUpStoryDataGenRaw from './beginners/basic-set-up/data-gen?raw'
import pointLabelsStoryRaw from './beginners/point-labels/index?raw'
import pointLabelsStoryDataRaw from './beginners/point-labels/data.ts?raw'
import pointLabelsStoryLabelsRaw from './beginners/point-labels/labels.ts?raw'
import pointLabelsStoryCssRaw from './beginners/point-labels/style.css?raw'
import removePointsStoryRaw from './beginners/remove-points/index?raw'
import removePointsStoryCssRaw from './beginners/remove-points/style.css?raw'
import removePointsStoryConfigRaw from './beginners/remove-points/config.ts?raw'
import removePointsStoryDataGenRaw from './beginners/remove-points/data-gen.ts?raw'
import linkHoveringStoryRaw from './beginners/link-hovering/index?raw'
import linkHoveringStoryDataGenRaw from './beginners/link-hovering/data-generator.ts?raw'
import linkHoveringStoryCssRaw from './beginners/link-hovering/style.css?raw'
import pinnedPointsStoryRaw from './beginners/pinned-points/index?raw'
import pinnedPointsStoryDataGenRaw from './beginners/pinned-points/data-gen.ts?raw'

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Beginners',
}

export const QuickStart: Story = {
  ...createStory(quickStart),
  parameters: {
    sourceCode: [
      { name: 'Story', code: quickStartStoryRaw },
    ],
  },
}

export const BasicSetUp: Story = {
  ...createStory(basicSetUp),
  name: '100x100 grid',
  parameters: {
    sourceCode: [
      { name: 'Story', code: basicSetUpStoryRaw },
      { name: 'style.css', code: basicSetUpStoryCssRaw },
      { name: 'data-gen', code: basicSetUpStoryDataGenRaw },
    ],
  },
}

export const PointLabels: Story = {
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
      d.args.graph?.destroy()
    }
  },
  render: (args, { loaded: { data } }) => {
    const story = pointLabels(data.performances)
    args.graph = story.graph
    return story.div
  },
  parameters: {
    sourceCode: [
      { name: 'Story', code: pointLabelsStoryRaw },
      { name: 'data.ts', code: pointLabelsStoryDataRaw },
      { name: 'labels.ts', code: pointLabelsStoryLabelsRaw },
      { name: 'style.css', code: pointLabelsStoryCssRaw },
    ],
  },
}

export const RemovePoints: Story = {
  ...createStory(removePoints),
  parameters: {
    sourceCode: [
      { name: 'Story', code: removePointsStoryRaw },
      { name: 'config.ts', code: removePointsStoryConfigRaw },
      { name: 'data-gen.ts', code: removePointsStoryDataGenRaw },
      { name: 'style.css', code: removePointsStoryCssRaw },
    ],
  },
}

export const LinkHovering: Story = {
  ...createStory(linkHovering),
  name: 'Link Hovering',
  parameters: {
    sourceCode: [
      { name: 'Story', code: linkHoveringStoryRaw },
      { name: 'data-generator.ts', code: linkHoveringStoryDataGenRaw },
      { name: 'style.css', code: linkHoveringStoryCssRaw },
    ],
  },
}

export const PinnedPoints: Story = {
  ...createStory(pinnedPoints),
  name: 'Pinned Points',
  parameters: {
    sourceCode: [
      { name: 'Story', code: pinnedPointsStoryRaw },
      { name: 'data-gen.ts', code: pinnedPointsStoryDataGenRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
