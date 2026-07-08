import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { basic3D } from './3d/basic'
import { clustering3D } from './3d/clustering'
import { collision3D } from './3d/collision'
import { forceLayout3D } from './3d/force-layout'
import { lattice3D } from './3d/lattice'
import { performance3D } from './3d/performance'
import { performanceSimulation3D } from './3d/performance-simulation'
import { samplingLabels3D } from './3d/sampling-labels'
import { silkroadTransactions3d } from './3d/silkroad-transactions'

import basic3DStoryRaw from './3d/basic/index?raw'
import basic3DStoryDataGenRaw from './3d/basic/data-gen?raw'
import clustering3DStoryRaw from './3d/clustering/index?raw'
import clustering3DStoryDataGenRaw from './3d/clustering/data-gen?raw'
import collision3DStoryRaw from './3d/collision/index?raw'
import collision3DStoryDataGenRaw from './3d/collision/data-gen?raw'
import forceLayout3DStoryRaw from './3d/force-layout/index?raw'
import forceLayout3DStoryDataGenRaw from './3d/force-layout/data-gen?raw'
import lattice3DStoryRaw from './3d/lattice/index?raw'
import lattice3DStoryDataGenRaw from './3d/lattice/data-gen?raw'
import performance3DStoryRaw from './3d/performance/index?raw'
import performance3DStoryDataGenRaw from './3d/performance/data-gen?raw'
import performanceSimulation3DStoryRaw from './3d/performance-simulation/index?raw'
import samplingLabels3DStoryRaw from './3d/sampling-labels/index?raw'
import silkroadTransactions3dStoryRaw from './3d/silkroad-transactions?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/3D',
}

export const Basic3D: Story = {
  ...createStory(basic3D),
  name: 'Basic 3D Rendering',
  parameters: {
    sourceCode: [
      { name: 'Story', code: basic3DStoryRaw },
      { name: 'data-gen.ts', code: basic3DStoryDataGenRaw },
    ],
  },
}

export const ForceLayout3D: Story = {
  ...createStory(forceLayout3D),
  name: 'Force Layout 3D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: forceLayout3DStoryRaw },
      { name: 'data-gen.ts', code: forceLayout3DStoryDataGenRaw },
    ],
  },
}

export const Lattice3D: Story = {
  ...createStory(lattice3D),
  name: 'Cube Lattice 3D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: lattice3DStoryRaw },
      { name: 'data-gen.ts', code: lattice3DStoryDataGenRaw },
    ],
  },
}

export const Performance3D: Story = {
  ...createStory(performance3D),
  name: '100k Points 3D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: performance3DStoryRaw },
      { name: 'data-gen.ts', code: performance3DStoryDataGenRaw },
    ],
  },
}

export const PerformanceSimulation3D: Story = {
  ...createStory(performanceSimulation3D),
  name: '100k Points Simulation 3D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: performanceSimulation3DStoryRaw },
      { name: 'data-gen.ts', code: forceLayout3DStoryDataGenRaw },
    ],
  },
}

export const Collision3D: Story = {
  ...createStory(collision3D),
  name: 'Collision Force 3D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: collision3DStoryRaw },
      { name: 'data-gen.ts', code: collision3DStoryDataGenRaw },
    ],
  },
}

export const Clustering3D: Story = {
  ...createStory(clustering3D),
  name: 'Cluster Force 3D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: clustering3DStoryRaw },
      { name: 'data-gen.ts', code: clustering3DStoryDataGenRaw },
    ],
  },
}

export const SamplingLabels3D: Story = {
  ...createStory(samplingLabels3D),
  name: 'Point Sampling & Labels 3D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: samplingLabels3DStoryRaw },
      { name: 'data-gen.ts', code: forceLayout3DStoryDataGenRaw },
    ],
  },
}

export const SilkRoadTransactions3D: Story = {
  ...createStory(silkroadTransactions3d),
  name: '3D Silk Road Bitcoin Transactions (parquet)',
  parameters: {
    sourceCode: [
      { name: 'Story', code: silkroadTransactions3dStoryRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
