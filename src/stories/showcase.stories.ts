import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { fullMesh } from './showcase/full-mesh'
import { meshWithHoles } from './showcase/mesh-with-holes'
import { radial } from './showcase/radial'
import { worm } from './showcase/worm'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import fullMeshRaw from './showcase/full-mesh?raw'
import meshWithHolesRaw from './showcase/mesh-with-holes?raw'
import radialRaw from './showcase/radial?raw'
import wormRaw from './showcase/worm?raw'

// Showcase holds the stories that teach no single API — they are combinations
// of things taught elsewhere, kept for the look of them. Anything that does
// demonstrate a specific method or config key belongs in its feature section.
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Showcase',
}

const sourceCodeAddonParams = [
  { name: 'create-cosmos', code: createCosmosRaw },
  { name: 'generate-mesh-data', code: generateMeshDataRaw },
]

export const FullMesh: Story = {
  ...createStory(fullMesh),
  name: 'Full Mesh',
  parameters: {
    sourceCode: [
      { name: 'Story', code: fullMeshRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

export const MeshWithHoles: Story = {
  ...createStory(meshWithHoles),
  name: 'Mesh with Holes',
  parameters: {
    sourceCode: [
      { name: 'Story', code: meshWithHolesRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

export const RadialMesh: Story = {
  ...createStory(radial),
  name: 'Radial Mesh',
  tags: ['large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: radialRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

export const Worm: Story = {
  ...createStory(worm),
  tags: ['large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: wormRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
