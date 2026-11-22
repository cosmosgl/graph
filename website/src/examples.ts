import researchNetworkManifest from './scenes/data/arxiv-grqc-manifest.json'

export const galleryExamples = [
  {
    id: 'research-network',
    image: 'knowledge-network',
    largeWidth: 3200,
    title: 'Knowledge Network',
    detail: `${researchNetworkManifest.pointCount.toLocaleString()} authors · ${researchNetworkManifest.linkCount.toLocaleString()} links`,
    alt: 'Colored coauthorship communities labeled with topics from their arXiv papers.',
  },
  {
    id: 'lorenz-attractor',
    image: 'lorenz-attractor',
    title: 'Ten Lorenz Trajectories',
    detail: '38,000 points · 10,660 links',
    alt: 'Fine blue, violet, and copper Lorenz trajectories trace two butterfly wings.',
  },
  {
    id: 'ten-million',
    image: 'ten-million',
    title: '10 Million Points',
    detail: '10,000,000 points',
    alt: 'Ten million cyan points reveal the fine folds of a Clifford attractor.',
  },
  {
    id: 'western-roads',
    image: 'western-roads',
    title: 'California–Nevada Road Network',
    detail: '1,890,815 points · 2,315,222 road links',
    alt: 'Luminous road segments map the geographic shape of California and Nevada.',
  },
  {
    id: 'worm',
    image: 'worm',
    title: 'Force-Directed Grid',
    detail: '10,000 points · 19,800 links',
    alt: 'A linked grid folds as warm colors travel across its points.',
  },
  {
    id: 'collision-stress-test',
    image: 'collision-stress-test',
    title: 'Point Collisions',
    detail: '50,000 points · Live collision simulation',
    alt: 'Fifty thousand circles form irregular lavender, purple, and blue patches.',
  },
]

// The gallery order also determines the previous and next links on each page.
export function examplePreview (
  example: typeof galleryExamples[number],
  assetBase: string
): { src: string; srcSet: string; alt: string; width: number; height: number } {
  const width = 880
  const src = `${assetBase}${example.image}.webp`
  const largeSrc = `${assetBase}${example.image}@2x.webp`
  return { src, srcSet: `${src} ${width}w, ${largeSrc} ${example.largeWidth ?? 1920}w`, alt: example.alt, width, height: 550 }
}
