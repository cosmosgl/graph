import { defineExperiment } from '../../runtime/experiment'

const subsetId = 'friendships-262k'
const question = 'How do both viewers draw and move the same real friendship network?'
const reference = 'Production WebGL with the same starting positions, links, styles and camera.'
const acceptance = 'Watch both layouts evolve, then pan or zoom to compare the same area.'
const environment = 'Apple M3, visible Chrome 157, production WebGL and experimental WebGPU.'
const evidence = [{ label: 'About the layout', page: 'layout' }]

export const experiment = defineExperiment({
  id: 'youtube-network',
  title: 'YouTube Network',
  summary: 'Run the YouTube friendship network at 262,144 or 1,000,000 points in WebGL and WebGPU.',
  tags: ['integration', 'rendering', 'interaction'],
  presentation: 'demo',
  caseChooserLabel: 'Graph size',
  cases: [{
    id: 'friendships',
    title: '1,000,000 points',
    kind: 'demonstrate',
    question,
    description: '1,000,000 points and 2,852,734 friendship links from the Stanford SNAP dataset. Press Run to watch both layouts spread.',
    reference,
    acceptance,
    recorded: {
      conclusion: 'Both viewers drew and moved the million-point graph in the recorded benchmark.',
      date: '20 November 2026',
      environment,
      scope: 'The million highest-degree accounts and all links between them, using seeded positions and two-pixel points.',
      limits: 'Both production WebGL controls stopped at their first moving rectangle selection. The full timing comparison remains inconclusive.',
      evidence,
    },
  }, {
    id: subsetId,
    title: '262,144 points',
    kind: 'demonstrate',
    question,
    description: '262,144 points and 1,369,771 friendship links from the tested YouTube subset. Press Run to watch both layouts spread.',
    reference,
    acceptance,
    recorded: {
      conclusion: 'Both viewers completed the recorded workflow, including moving rectangle and polygon selection and 1,000 tracked labels.',
      date: '20 November 2026',
      environment,
      scope: 'The first 262,144 points in the prepared fixture and all links between them.',
      limits: 'Production WebGL frame intervals varied across runs, leaving the steady-motion timing verdict inconclusive.',
      evidence,
    },
  }],
  create: async (host, caseId) => {
    const subset = caseId === subsetId
    const { createLargeComparisonView } = await import('../viewer-comparison/large-comparison-view')
    return createLargeComparisonView(host, {
      kind: 'youtube',
      title: 'YouTube Network',
      pointCount: subset ? 262144 : 1000000,
      benchmarkSection: subset ? 'youtube-capacity' : 'youtube-1-000-000-points-2-852-734-edges',
    })
  },
  pages: [{
    kind: 'markdown',
    id: 'layout',
    title: 'About the layout',
    load: async (): Promise<string> => (await import('./layout.md?raw')).default,
  }],
})
