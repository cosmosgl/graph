import type { Meta } from '@storybook/html'

import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import { radial } from './clustering/radial'
import { withLabels } from './clustering/with-labels'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import createClusterLabelsRaw from './create-cluster-labels?raw'
import radialStoryRaw from './clustering/radial?raw'
import withLabelsStoryRaw from './clustering/with-labels?raw'

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

export const Radial: Story = {
  ...createStory(radial),
  tags: ['large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: radialStoryRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

export const WithLabels: Story = {
  ...createStory(withLabels),
  name: 'Cluster Labels',
  tags: ['labels', 'large-data', 'advanced'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: withLabelsStoryRaw },
      { name: 'create-cluster-labels', code: createClusterLabelsRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
