import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { meshWithHoles } from './misc/mesh-with-holes'
import { fullMesh } from './misc/full-mesh'
import { onDemandRendering } from './misc/on-demand-rendering'
import { pointOcclusionCulling } from './misc/point-occlusion-culling'
import { repulsionBenchmark } from './misc/repulsion-benchmark'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import meshWithHolesRaw from './misc/mesh-with-holes?raw'
import fullMeshRaw from './misc/full-mesh?raw'
import onDemandRenderingRaw from './misc/on-demand-rendering?raw'
import pointOcclusionCullingRaw from './misc/point-occlusion-culling?raw'
import repulsionBenchmarkRaw from './misc/repulsion-benchmark?raw'

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

export const PointOcclusionCulling: Story = {
  ...createStory(pointOcclusionCulling),
  name: 'Point Occlusion Culling',
  parameters: {
    sourceCode: [
      { name: 'Story', code: pointOcclusionCullingRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

export const OnDemandRendering: Story = {
  ...createStory(onDemandRendering),
  name: 'On-Demand Rendering',
  parameters: {
    sourceCode: [
      { name: 'Story', code: onDemandRenderingRaw },
      ...sourceCodeAddonParams,
    ],
  },
}

export const RepulsionBenchmark: Story = {
  ...createStory(repulsionBenchmark),
  parameters: {
    sourceCode: [
      { name: 'Story', code: repulsionBenchmarkRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
