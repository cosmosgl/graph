import type { Meta } from '@storybook/html'
import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import { withLabels } from './clusters/with-labels'
import { worm } from './clusters/worm'
import { radial } from './clusters/radial'
import { polygonSelection } from './clusters/polygon-selection'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import withLabelsStoryRaw from './clusters/with-labels?raw'
import createClusterLabelsRaw from './create-cluster-labels?raw'
import wormStory from './clusters/worm?raw'
import radialStory from './clusters/radial?raw'
import polygonSelectionStory from './clusters/polygon-selection?raw'
import polygonSelectionStyleRaw from './clusters/polygon-selection/style.css?raw'
import polygonSelectionPolygonRaw from './clusters/polygon-selection/polygon.ts?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Forces/Clustering',
  parameters: {
    controls: {
      disable: true,
    },
  },
}

const sourceCodeAddonParams = [
  { name: 'create-cosmos', code: createCosmosRaw },
  { name: 'generate-mesh-data', code: generateMeshDataRaw },
]

export const Worm: Story = {
  ...createStory(worm),
  parameters: {
    sourceCode: [
      { name: 'Story', code: wormStory },
      ...sourceCodeAddonParams,
    ],
  },
}

export const Radial: Story = {
  ...createStory(radial),
  parameters: {
    sourceCode: [
      { name: 'Story', code: radialStory },
      ...sourceCodeAddonParams,
    ],
  },
}

export const WithLabels: Story = {
  ...createStory(withLabels),
  parameters: {
    sourceCode: [
      { name: 'Story', code: withLabelsStoryRaw },
      { name: 'create-cluster-labels', code: createClusterLabelsRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

export const PolygonSelection: Story = {
  ...createStory(polygonSelection),
  parameters: {
    sourceCode: [
      { name: 'Story', code: polygonSelectionStory },
      { name: 'polygon.ts', code: polygonSelectionPolygonRaw },
      ...sourceCodeAddonParams,
      { name: 'style.css', code: polygonSelectionStyleRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
