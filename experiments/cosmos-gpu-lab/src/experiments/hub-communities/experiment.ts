import { experimentHref } from '../../app/router'
import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'hub-communities',
  title: 'Hub Communities',
  summary: 'Compare the motion of a highly connected hub in a million-point graph.',
  tags: ['integration', 'rendering', 'interaction'],
  presentation: 'demo',
  showPeerLinks: false,
  cases: [{
    id: 'moving-hub',
    title: 'Watch a hub with 8,192 links',
    kind: 'demonstrate',
    question: 'How does a highly connected hub move in the two viewers?',
    description: '1,000,000 points and 999,990 links. Press Run to watch the hub with 8,192 links move away from the rightmost community.',
    reference: 'Production WebGL with the same starting positions, links, styles and camera.',
    acceptance: 'Start both simulations and watch the hub move. Use Fit to see all eight communities.',
    recorded: {
      conclusion: 'Both viewers kept the hub visible. WebGPU had a shorter frame interval in the separate steady-motion confirmation.',
      date: '20 November 2026',
      environment: 'Apple M3, visible Chrome 157, production WebGL and experimental WebGPU.',
      scope: 'The million-point hub fixture with a moving hub and default forces.',
      limits: 'The confirmation measured steady motion. The earlier full-workflow timing comparison was inconclusive.',
      evidence: [{ label: 'About the layout', page: 'layout' }],
    },
  }],
  create: async host => (await import('../viewer-comparison/large-comparison-view')).createLargeComparisonView(host, {
    kind: 'hubs',
    title: 'Hub Communities',
    benchmark: {
      href: experimentHref('viewer-comparison', 'migration-results', 'hub-communities-1-000-000-points-999-990-edges'),
      chart: {
        title: 'Slow frames took less than half as long with WebGPU',
        context: '95th-percentile frame interval · Separate steady-motion confirmation on Apple M3 · One million points',
        unit: 'ms',
        bars: [['WebGL', 151.7], ['WebGPU', 68.5]],
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
