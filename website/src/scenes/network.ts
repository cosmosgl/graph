import { getRgbaColor } from '@cosmos.gl/graph'
import { studyPalette } from './palette'
import manifest from './data/arxiv-grqc-manifest.json'
import { loadResearchNetwork } from './research-network-data'
import type { GeneratedSceneDefinition } from './types'

const { pointCount, linkCount, paperCount, communityCount, categoryNames } = manifest
const categoryPalette = [
  studyPalette[9], studyPalette[6], studyPalette[8], studyPalette[1], studyPalette[0],
  studyPalette[5], studyPalette[2], studyPalette[7], studyPalette[4], studyPalette[3],
]

export const researchNetwork: GeneratedSceneDefinition = {
  id: 'research-network',
  title: 'Knowledge Network',
  description: `Coauthorship across ${paperCount.toLocaleString()} arXiv papers in general relativity and quantum cosmology, 1993–2003. ` +
    'Each author is colored by their most frequent additional arXiv category, or GR-QC if their papers have no other category.',
  pointCount,
  linkCount,
  loadingDataset: true,
  initialZoomFactor: 2,
  background: '#111318',
  source: { label: 'arXiv GR-QC data ↗', url: 'https://arxiv.org/archive/gr-qc' },
  simulation: {
    randomSeed: 42,
    simulationRepulsion: 14,
    simulationRepulsionSamples: 16,
    simulationGravity: 0.65,
    simulationCenter: 0.005,
    simulationCluster: 0.25,
    simulationLinkSpring: 0.6,
    simulationLinkDistance: 40,
    simulationLinkDistRandomVariationRange: [0.9, 1.3],
    simulationFriction: 0.83,
    simulationDecay: 8000,
    curvedLinks: true,
    linkColorInterpolateFromEndpoints: true,
    linkVisibilityDistanceRange: [100, 3000],
    linkVisibilityMinTransparency: 0.6,
  },
  create: async (random, signal) => {
    const { names, communities, categories, links, groups } = await loadResearchNetwork(manifest, signal)
    const colorsByCategory = categoryPalette.map(color => getRgbaColor(color))
    const pointPalette = categoryNames.map((_, index) => {
      const [r, g, b, a] = colorsByCategory[index % colorsByCategory.length]!
      const tint = Math.floor(index / colorsByCategory.length) * 0.8 / Math.ceil(categoryNames.length / colorsByCategory.length)
      return [r + (1 - r) * tint, g + (1 - g) * tint, b + (1 - b) * tint, a] as const
    })
    const communitySizes = new Uint32Array(communityCount)
    const communityCategories = groups.map(() => new Uint32Array(categoryNames.length))
    const positions = new Float32Array(pointCount * 2)
    const colors = new Float32Array(pointCount * 4)
    const sizes = new Float32Array(pointCount)
    const linkColors = new Float32Array(linkCount * 4)
    const linkWidths = new Float32Array(linkCount)
    const degrees = new Uint32Array(pointCount)
    const pointLabels: string[] = []
    for (let i = 0; i < links.length; i++) degrees[links[i]!]!++
    for (let i = 0; i < pointCount; i++) {
      const community = communities[i]!
      const category = categories[i]!
      communitySizes[community]!++
      communityCategories[community]![category]!++
      const communityAngle = community * Math.PI * (3 - Math.sqrt(5))
      const communityRadius = Math.sqrt((community + 0.5) / communityCount)
      const angle = random() * Math.PI * 2
      const radius = Math.sqrt(random()) * 0.055
      // Community-aware seeds reveal structure immediately; every node remains free.
      positions[i * 2] = Math.cos(communityAngle) * communityRadius * 1.25 + Math.cos(angle) * radius
      positions[i * 2 + 1] = Math.sin(communityAngle) * communityRadius * 0.64 + Math.sin(angle) * radius
      const color = pointPalette[category]!
      const collaboratorCount = degrees[i]!
      const light = Math.min(0.28, Math.sqrt(collaboratorCount) * 0.022)
      for (let channel = 0; channel < 3; channel++) colors[i * 4 + channel] = color[channel]! * (1 - light) + light
      colors[i * 4 + 3] = 0.92
      sizes[i] = 10 + Math.sqrt(collaboratorCount) * 3.5
      const collaborators = collaboratorCount === 1 ? 'collaborator' : 'collaborators'
      pointLabels.push(`${names[i]} · ${collaboratorCount} ${collaborators}\narXiv: ${categoryNames[category]}\n${groups[community]}`)
    }
    const clusterLabels = groups.map((text, index) => {
      const counts = communityCategories[index]!
      const category = counts.reduce((best, count, i) => count > counts[best]! ? i : best, 0)
      const [r, g, b] = pointPalette[category]!
      return { text, color: `rgb(${r * 255} ${g * 255} ${b * 255})`, weight: communitySizes[index]! }
    })
    for (let i = 0; i < linkCount; i++) {
      const source = links[i * 2]!
      const target = links[i * 2 + 1]!
      const sameCommunity = communities[source] === communities[target]
      // The shader takes RGB from each endpoint. Keep the per-link opacity here.
      linkColors[i * 4 + 3] = sameCommunity ? 0.22 : 0.12
      linkWidths[i] = sameCommunity ? 0.65 : 0.4
    }
    return { positions, colors, sizes, links, linkColors, linkWidths, pointLabels, pointClusters: communities, clusterLabels }
  },
}
