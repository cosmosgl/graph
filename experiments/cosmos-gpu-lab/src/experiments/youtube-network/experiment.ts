import { experimentHref, roadmapHref } from '../../app/router'
import { defineExperiment } from '../../runtime/experiment'
import type { ResultChart } from '../../runtime/result-chart'
import { youtubeMotionResult } from './motion-result'

const subsetId = 'friendships-262k'
const sparseId = 'friendships-300k'
const title = 'YouTube Network'
const question = 'How do both viewers draw and move the same real friendship network?'
const reference = 'Production WebGL with the same starting positions, links, styles and camera.'
const acceptance = 'Watch both layouts evolve, then pan or zoom to compare the same area.'
const environment = 'Apple M3, visible Chrome 157, production WebGL and experimental WebGPU.'
const evidence = [{ label: 'About the layout', page: 'layout' }]
const subsetUpdateResult: ResultChart = {
  title: 'A small point update finished sooner with WebGPU',
  context: 'Time from a sparse position update to a completed frame · 262,144 points · Recorded on Apple M3',
  unit: 'ms',
  bars: [['WebGL', 795], ['WebGPU', 31.8]],
}

export const experiment = defineExperiment({
  id: 'youtube-network',
  title,
  summary: 'Compare WebGL and WebGPU on three YouTube friendship graphs, including a sample with 300,000 points and 300,000 links.',
  tags: ['integration', 'rendering', 'interaction'],
  presentation: 'demo',
  showPeerLinks: false,
  caseChooserLabel: 'Graph size',
  cases: [{
    id: 'friendships',
    title: '1,000,000 points',
    kind: 'demonstrate',
    question,
    description: '1,000,000 points and 2,852,734 friendship links from the Stanford SNAP dataset.',
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
    description: '262,144 points and 1,369,771 friendship links from the tested YouTube subset.',
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
  }, {
    id: sparseId,
    title: '300,000 points · 300,000 links',
    kind: 'demonstrate',
    question,
    description: '300,000 points and 300,000 friendship links sampled from the YouTube network. Every point has a link.',
    reference,
    acceptance,
    recorded: {
      conclusion: 'WebGPU completed more simulation frames per second in both recorded solo runs.',
      date: '20 November 2026',
      environment,
      scope: 'Two solo runs per backend with the same camera, counting GPU-completed frames over ticks 13–72.',
      limits: 'The result covers motion on this sampled graph. Full interaction and layout acceptance remain unassessed.',
      evidence,
    },
  }],
  create: async (host, caseId) => {
    const { createLargeComparisonView } = await import('../viewer-comparison/large-comparison-view')
    if (caseId === sparseId) {
      return createLargeComparisonView(host, {
        kind: 'youtube',
        title,
        pointCount: 300000,
        youtubeTopology: 'sparse',
        benchmark: { href: roadmapHref('current-focus'), chart: youtubeMotionResult },
      })
    }
    const subset = caseId === subsetId
    const section = subset ? 'youtube-capacity' : 'youtube-1-000-000-points-2-852-734-edges'
    return createLargeComparisonView(host, {
      kind: 'youtube',
      title,
      pointCount: subset ? 262144 : 1000000,
      benchmark: {
        href: experimentHref('viewer-comparison', 'migration-results', section),
        chart: subset ? subsetUpdateResult : undefined,
      },
    })
  },
  pages: [{
    kind: 'markdown',
    id: 'layout',
    title: 'About the layout',
    load: async (): Promise<string> => (await import('./layout.md?raw')).default,
  }],
})
