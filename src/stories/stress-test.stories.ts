import type { Meta } from '@storybook/html'

import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import { hyperbolicStressTest } from './stress-test'
import { githubStressTest } from './experiments/github-stress'

import hyperbolicStressTestStoryRaw from './stress-test/index?raw'
import hyperbolicUtilsRaw from './utils?raw'
import githubStressTestStoryRaw from './experiments/github-stress/index?raw'
import nnDescentRaw from './experiments/github-stress/nn-descent?raw'
import pcaRaw from './experiments/github-stress/pca?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Stress Test',
  parameters: {
    controls: {
      disable: true,
    },
  },
}

export const HyperbolicLargeGraph: Story = {
  ...createStory(hyperbolicStressTest),
  name: 'Hyperbolic Graph (140k points, ~1M links)',
  parameters: {
    sourceCode: [
      { name: 'Story', code: hyperbolicStressTestStoryRaw },
      { name: 'Generator', code: hyperbolicUtilsRaw },
    ],
  },
}

export const GithubEmbeddings: Story = {
  ...createStory(githubStressTest),
  name: 'GPU UMAP — 100k GitHub repos (in-browser kNN)',
  parameters: {
    sourceCode: [
      { name: 'Story', code: githubStressTestStoryRaw },
      { name: 'pca.ts', code: pcaRaw },
      { name: 'nn-descent.ts', code: nnDescentRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
