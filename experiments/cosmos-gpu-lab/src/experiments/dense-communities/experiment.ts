import { experimentHref } from '../../app/router'
import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'dense-communities',
  title: 'Dense Communities',
  summary: 'See the same million-point graph move in WebGL and WebGPU.',
  tags: ['integration', 'rendering', 'interaction'],
  presentation: 'demo',
  cases: [{
    id: 'dense-communities',
    title: 'Watch eight communities move',
    kind: 'demonstrate',
    question: 'How do the same eight communities look as they move?',
    description: 'Eight communities, 1,000,000 points, and 999,990 links. Both graphs start from the same layout.',
    reference: 'Production WebGL with the same starting positions, links, styles and camera.',
    acceptance: 'Run both graphs, then zoom in to see the local links and how points move around their anchors.',
    recorded: {
      conclusion: 'Both viewers moved the free points and preserved all eight communities in the matched study.',
      date: '20 November 2026',
      environment: 'Apple M3, visible Chrome 157, production WebGL and experimental WebGPU.',
      scope: 'One million points with local springs to pinned anchors, using default forces and basic styles.',
      limits: 'The recorded benchmark ran each viewer separately.',
      evidence: [{ label: 'About the layout', page: 'layout' }],
    },
  }],
  create: async host => (await import('../viewer-comparison/large-comparison-view')).createLargeComparisonView(host, {
    kind: 'dense',
    title: 'Dense Communities',
    benchmark: {
      href: experimentHref('viewer-comparison', 'migration-results', 'dense-communities-1-000-000-points-999-990-edges'),
      chart: {
        title: 'Slow frames took less than half as long with WebGPU',
        context: '95th-percentile frame interval during steady motion · One million points · Separate runs on Apple M3',
        unit: 'ms',
        bars: [['WebGL', 151.4], ['WebGPU', 67.0]],
      },
    },
  }),
  pages: [{
    kind: 'markdown',
    id: 'layout',
    title: 'About the layout',
    load: async (): Promise<string> => (await import('./layout.md?raw')).default,
  }],
})
