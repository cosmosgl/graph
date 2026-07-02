import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { basic3D } from './3d/basic'
import { forceLayout3D } from './3d/force-layout'
import { lattice3D } from './3d/lattice'

import basic3DStoryRaw from './3d/basic/index?raw'
import basic3DStoryDataGenRaw from './3d/basic/data-gen?raw'
import forceLayout3DStoryRaw from './3d/force-layout/index?raw'
import forceLayout3DStoryDataGenRaw from './3d/force-layout/data-gen?raw'
import lattice3DStoryRaw from './3d/lattice/index?raw'
import lattice3DStoryDataGenRaw from './3d/lattice/data-gen?raw'

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

// eslint-disable-next-line import/no-default-export
export default meta
