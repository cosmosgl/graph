import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { actions } from './interaction/actions'
import { exploreConnections } from './interaction/explore-connections'
import { polygonSelection } from './interaction/lasso-selection'
import { pinnedPoints } from './interaction/pinned-points'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import actionsStoryRaw from './interaction/actions/index?raw'
import actionsCssRaw from './interaction/actions/style.css?raw'
import actionsDataGenRaw from './interaction/actions/data-gen?raw'
import exploreConnectionsStoryRaw from './interaction/explore-connections/index?raw'
import exploreConnectionsDataGenRaw from './interaction/explore-connections/data-gen?raw'
import exploreConnectionsCssRaw from './interaction/explore-connections/style.css?raw'
import lassoSelectionStoryRaw from './interaction/lasso-selection/index?raw'
import lassoSelectionPolygonRaw from './interaction/lasso-selection/polygon?raw'
import lassoSelectionCssRaw from './interaction/lasso-selection/style.css?raw'
import pinnedPointsStoryRaw from './interaction/pinned-points/index?raw'
import pinnedPointsDataGenRaw from './interaction/pinned-points/data-gen?raw'

const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Interaction',
}

export const Actions: Story = {
  ...createStory(actions),
  tags: ['interactive', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: actionsStoryRaw },
      { name: 'style.css', code: actionsCssRaw },
      { name: 'data-gen', code: actionsDataGenRaw },
    ],
  },
}

export const ExploreConnections: Story = {
  ...createStory(exploreConnections),
  name: 'Explore Connections',
  tags: ['interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: exploreConnectionsStoryRaw },
      { name: 'data-gen.ts', code: exploreConnectionsDataGenRaw },
      { name: 'style.css', code: exploreConnectionsCssRaw },
    ],
  },
}

export const LassoSelection: Story = {
  ...createStory(polygonSelection),
  name: 'Lasso Selection',
  tags: ['interactive', 'advanced', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: lassoSelectionStoryRaw },
      { name: 'polygon.ts', code: lassoSelectionPolygonRaw },
      { name: 'create-cosmos', code: createCosmosRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
      { name: 'style.css', code: lassoSelectionCssRaw },
    ],
  },
}

export const PinnedPoints: Story = {
  ...createStory(pinnedPoints),
  name: 'Pinned Points',
  tags: ['advanced'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: pinnedPointsStoryRaw },
      { name: 'data-gen.ts', code: pinnedPointsDataGenRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
