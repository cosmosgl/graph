import type { Meta } from '@storybook/html'

import { createStory, Story } from '@/graph/stories/create-story'
import { CosmosStoryProps } from './create-cosmos'
import { meshWithHoles } from './experiments/mesh-with-holes'
import { fullMesh } from './experiments/full-mesh'
import { onDemandRendering } from './experiments/on-demand-rendering'
import { pointOcclusionCulling } from './experiments/point-occlusion-culling'
import { umapEmbedding } from './experiments/umap-embedding'
import { umapEmbedding3d } from './experiments/umap-embedding/index-3d'
import { mammothProjection } from './experiments/umap-embedding/mammoth'
import { mammothTsneProjection } from './experiments/umap-embedding/mammoth-tsne'
import { tsneZValidation } from './experiments/umap-embedding/tsne-z-validation'
import { embeddingBenchmark } from './experiments/umap-embedding/benchmark'

import createCosmosRaw from './create-cosmos?raw'
import generateMeshDataRaw from './generate-mesh-data?raw'
import meshWithHolesRaw from './experiments/mesh-with-holes?raw'
import fullMeshRaw from './experiments/full-mesh?raw'
import onDemandRenderingRaw from './experiments/on-demand-rendering?raw'
import pointOcclusionCullingRaw from './experiments/point-occlusion-culling?raw'
import umapEmbeddingRaw from './experiments/umap-embedding/index?raw'
import umapEmbedding3dRaw from './experiments/umap-embedding/index-3d?raw'
import umapEmbeddingDataGenRaw from './experiments/umap-embedding/data-gen?raw'
import umapEmbeddingCountriesRaw from './experiments/umap-embedding/countries-data?raw'
import umapEmbeddingLabelsRaw from './experiments/umap-embedding/labels?raw'
import mammothProjectionRaw from './experiments/umap-embedding/mammoth?raw'
import mammothTsneProjectionRaw from './experiments/umap-embedding/mammoth-tsne?raw'
import tsneZValidationRaw from './experiments/umap-embedding/tsne-z-validation?raw'
import embeddingBenchmarkRaw from './experiments/umap-embedding/benchmark?raw'
import benchmarkReferencePyRaw from './experiments/umap-embedding/benchmark-reference.py?raw'
import mammothDataRaw from './experiments/umap-embedding/mammoth-data?raw'

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
export const UmapEmbedding: Story = {
  ...createStory(umapEmbedding),
  name: 'UMAP Embedding 2D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: umapEmbeddingRaw },
      { name: 'data-gen.ts', code: umapEmbeddingDataGenRaw },
      { name: 'countries-data.ts', code: umapEmbeddingCountriesRaw },
      { name: 'labels.ts', code: umapEmbeddingLabelsRaw },
    ],
  },
}
export const UmapEmbedding3D: Story = {
  ...createStory(umapEmbedding3d),
  name: 'UMAP Embedding 3D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: umapEmbedding3dRaw },
      { name: 'data-gen.ts', code: umapEmbeddingDataGenRaw },
      { name: 'countries-data.ts', code: umapEmbeddingCountriesRaw },
      { name: 'labels.ts', code: umapEmbeddingLabelsRaw },
    ],
  },
}
export const MammothProjection: Story = {
  ...createStory(mammothProjection),
  name: 'UMAP Mammoth 2D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: mammothProjectionRaw },
      { name: 'data-gen.ts', code: umapEmbeddingDataGenRaw },
      { name: 'mammoth-data.ts', code: mammothDataRaw },
    ],
  },
}
export const MammothTsneProjection: Story = {
  ...createStory(mammothTsneProjection),
  name: 't-SNE Mammoth 2D',
  parameters: {
    sourceCode: [
      { name: 'Story', code: mammothTsneProjectionRaw },
      { name: 'data-gen.ts', code: umapEmbeddingDataGenRaw },
      { name: 'mammoth-data.ts', code: mammothDataRaw },
    ],
  },
}
export const TsneZValidation: Story = {
  ...createStory(tsneZValidation),
  name: 't-SNE Z Validation',
  parameters: {
    sourceCode: [
      { name: 'Story', code: tsneZValidationRaw },
      { name: 'data-gen.ts', code: umapEmbeddingDataGenRaw },
    ],
  },
}
export const EmbeddingBenchmark: Story = {
  ...createStory(embeddingBenchmark),
  name: 'Embedding Quality Benchmark',
  parameters: {
    sourceCode: [
      { name: 'Story', code: embeddingBenchmarkRaw },
      { name: 'benchmark-reference.py', code: benchmarkReferencePyRaw },
      { name: 'data-gen.ts', code: umapEmbeddingDataGenRaw },
    ],
  },
}

// eslint-disable-next-line import/no-default-export
export default meta
