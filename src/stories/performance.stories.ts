import type { Meta } from '@storybook/html'

import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import { hyperbolicStressTest } from './performance/hyperbolic'
import { collisionStressTest } from './performance/collision-stress-test'
import { pointOcclusionCulling } from './performance/point-occlusion-culling'
import { onDemandRendering } from './performance/on-demand-rendering'
import { repulsionBenchmark } from './performance/repulsion-benchmark'
import { steadyStateMotion } from './performance/steady-state-motion'
import { sampleCountUnderLoad } from './performance/sample-count-under-load'
import { spaceWall } from './performance/space-wall'
import { farPoint } from './performance/far-point'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import hyperbolicUtilsRaw from './utils?raw'
import hyperbolicStoryRaw from './performance/hyperbolic?raw'
import collisionStressTestRaw from './performance/collision-stress-test?raw'
import pointOcclusionCullingRaw from './performance/point-occlusion-culling?raw'
import onDemandRenderingRaw from './performance/on-demand-rendering?raw'
import repulsionBenchmarkRaw from './performance/repulsion-benchmark?raw'
import steadyStateMotionRaw from './performance/steady-state-motion?raw'
import sampleCountUnderLoadRaw from './performance/sample-count-under-load?raw'
import countryBordersDataRaw from './performance/country-borders-data?raw'
import spaceWallRaw from './performance/space-wall?raw'
import farPointRaw from './performance/far-point?raw'

// These exist to show a cost or a limit rather than a feature. Most run an FPS
// monitor; several will be slow to start on weak hardware.
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Performance',
  parameters: {
    controls: {
      disable: true,
    },
  },
}

export const HyperbolicLargeGraph: Story = {
  ...createStory(hyperbolicStressTest),
  name: 'Hyperbolic Graph (140k points, ~1M links)',
  tags: ['perf', 'large-data', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: hyperbolicStoryRaw },
      { name: 'Generator', code: hyperbolicUtilsRaw },
    ],
  },
}

export const CollisionStressTest: Story = {
  ...createStory(collisionStressTest),
  name: 'Collision (50k points)',
  tags: ['perf', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: collisionStressTestRaw },
      { name: 'create-cosmos', code: createCosmosRaw },
    ],
  },
}

export const PointOcclusionCulling: Story = {
  ...createStory(pointOcclusionCulling),
  name: 'Point Occlusion Culling (200k points)',
  tags: ['perf', 'large-data', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: pointOcclusionCullingRaw },
    ],
  },
}

export const OnDemandRendering: Story = {
  ...createStory(onDemandRendering),
  name: 'On-Demand Rendering',
  tags: ['perf'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: onDemandRenderingRaw },
      { name: 'create-cosmos', code: createCosmosRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

export const RepulsionBenchmark: Story = {
  ...createStory(repulsionBenchmark),
  name: 'Repulsion Benchmark',
  tags: ['perf', 'advanced'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: repulsionBenchmarkRaw },
    ],
  },
}

export const SteadyStateMotion: Story = {
  ...createStory(steadyStateMotion),
  name: 'Steady-State Motion',
  tags: ['perf', 'advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: steadyStateMotionRaw },
      { name: 'Data', code: countryBordersDataRaw },
    ],
  },
}

export const SampleCountUnderLoad: Story = {
  ...createStory(sampleCountUnderLoad),
  name: 'Sample Count Under Load',
  tags: ['perf', 'advanced', 'interactive', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: sampleCountUnderLoadRaw },
      { name: 'Generator', code: hyperbolicUtilsRaw },
    ],
  },
}

export const SpaceWall: Story = {
  ...createStory(spaceWall),
  name: 'Space Size Wall',
  tags: ['perf', 'advanced', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: spaceWallRaw },
    ],
  },
}

export const FarPoint: Story = {
  ...createStory(farPoint),
  name: 'Far Point vs the Grid',
  tags: ['perf', 'advanced', 'interactive', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: farPointRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
