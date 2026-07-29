import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { collision } from './forces/collision'
import { withLabels } from './forces/with-labels'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import createClusterLabelsRaw from './create-cluster-labels?raw'
import collisionRaw from './forces/collision?raw'
import withLabelsStoryRaw from './forces/with-labels?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Forces',
}

export const Collision: Story = {
  ...createStory(collision),
  tags: ['beginner'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: collisionRaw },
      { name: 'create-cosmos', code: createCosmosRaw },
    ],
  },
}

export const ClusterLabels: Story = {
  ...createStory(withLabels),
  name: 'Clusters with Labels',
  tags: ['labels', 'large-data', 'advanced'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: withLabelsStoryRaw },
      { name: 'create-cluster-labels', code: createClusterLabelsRaw },
      { name: 'create-cosmos', code: createCosmosRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
