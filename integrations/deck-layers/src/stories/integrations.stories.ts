import type { Meta } from '@storybook/html'

import { CosmosStoryProps } from '@/graph/stories/create-cosmos'
import { createStory, Story } from '@/graph/stories/create-story'
import generateMeshDataRaw from '@/graph/stories/generate-mesh-data?raw'
import { graphLayer } from './graph-layer'
import { bigGraph } from './big-graph'
import { miniGraphs } from './mini-graphs'
import { graphOnMap } from './graph-on-map'
import { customDeckLayers } from './custom-deck-layers'

import graphLayerRaw from './graph-layer?raw'
import bigGraphRaw from './big-graph?raw'
import miniGraphsRaw from './mini-graphs?raw'
import graphOnMapRaw from './graph-on-map?raw'
import customDeckLayersRaw from './custom-deck-layers?raw'
import pointsLayerRaw from './custom-deck-layers/points-layer?raw'
import pointsLayerUniformsRaw from './custom-deck-layers/points-layer-uniforms?raw'
import linksLayerRaw from './custom-deck-layers/links-layer?raw'
import linksLayerUniformsRaw from './custom-deck-layers/links-layer-uniforms?raw'
import blendParametersRaw from './custom-deck-layers/blend-parameters?raw'
import styleRaw from './style.css?raw'

// Embedding cosmos.gl in deck.gl with `CosmosGraphLayer` from
// @cosmos.gl/deck-layers: the layer the deck.gl way, the layer at scale on
// cosmos.gl's flat arrays, the application owning the graphs, the layer on a
// map — and, last, a renderer of your own over the live position texture,
// with the two example layers as panes.
const meta: Meta<CosmosStoryProps> = {
  title: 'Examples/Integrations',
  parameters: {
    controls: {
      disable: true,
    },
  },
}

export const GraphLayer: Story = {
  ...createStory(graphLayer),
  name: 'Graph layer',
  tags: ['beginner', 'interactive', 'labels'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: graphLayerRaw },
      { name: 'style.css', code: styleRaw },
    ],
  },
}

export const BigGraph: Story = {
  ...createStory(bigGraph),
  name: 'Big graph',
  tags: ['advanced', 'perf', 'large-data'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: bigGraphRaw },
      { name: 'style.css', code: styleRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

export const MiniGraphs: Story = {
  ...createStory(miniGraphs),
  name: 'Mini graphs',
  tags: ['advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: miniGraphsRaw },
      { name: 'style.css', code: styleRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

export const GraphOnMap: Story = {
  ...createStory(graphOnMap),
  name: 'Graph on a map',
  tags: ['advanced', 'interactive', 'labels'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: graphOnMapRaw },
      { name: 'style.css', code: styleRaw },
    ],
  },
}

export const CustomDeckLayers: Story = {
  ...createStory(customDeckLayers),
  name: 'Custom deck layers',
  tags: ['advanced', 'interactive'],
  parameters: {
    sourceCode: [
      { name: 'Story', code: customDeckLayersRaw },
      { name: 'PointsLayer', code: pointsLayerRaw },
      { name: 'points-layer-uniforms', code: pointsLayerUniformsRaw },
      { name: 'LinksLayer', code: linksLayerRaw },
      { name: 'links-layer-uniforms', code: linksLayerUniformsRaw },
      { name: 'blend-parameters', code: blendParametersRaw },
      { name: 'style.css', code: styleRaw },
      { name: 'generate-mesh-data', code: generateMeshDataRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
