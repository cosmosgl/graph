import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { meshWithHoles } from './experiments/mesh-with-holes'
import { fullMesh } from './experiments/full-mesh'
import { onDemandRendering } from './experiments/on-demand-rendering'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import meshWithHolesRaw from './experiments/mesh-with-holes?raw'
import fullMeshRaw from './experiments/full-mesh?raw'
import onDemandRenderingRaw from './experiments/on-demand-rendering?raw'

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Misc',
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
export const OnDemandRendering: Story = {
  ...createStory(onDemandRendering),
  parameters: {
    sourceCode: [
      { name: 'Story', code: onDemandRenderingRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
