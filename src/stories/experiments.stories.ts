import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { meshWithHoles } from './experiments/mesh-with-holes'
import { fullMesh } from './experiments/full-mesh'
import { collision } from './experiments/collision'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import meshWithHolesRaw from './experiments/mesh-with-holes?raw'
import fullMeshRaw from './experiments/full-mesh?raw'
import collisionRaw from './experiments/collision?raw'

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Experiments',
}

const sourceCodeAddonParams = [
  { name: 'create-cosmos', code: createCosmosRaw },
  { name: 'generate-mesh-data', code: generateMeshDataRaw },
]

export const FullMesh: Story = {
  ...createStory(fullMesh),
  parameters: {
    sourceCode: [
      { name: 'Story', code: fullMeshRaw },
      ...sourceCodeAddonParams,
    ],
  },
}
export const MeshWithHoles: Story = {
  ...createStory(meshWithHoles),
  parameters: {
    sourceCode: [
      { name: 'Story', code: meshWithHolesRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

export const Collision: Story = {
  ...createStory(collision),
  parameters: {
    sourceCode: [
      { name: 'Story', code: collisionRaw },
      { name: 'create-cosmos', code: createCosmosRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
