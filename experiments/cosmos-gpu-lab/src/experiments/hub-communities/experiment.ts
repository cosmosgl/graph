import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'hub-communities',
  title: 'Hub Communities',
  summary: 'Compare the motion of a highly connected hub in a million-point graph.',
  tags: ['integration', 'rendering', 'interaction'],
  presentation: 'demo',
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
    benchmarkSection: 'hub-communities-1-000-000-points-999-990-edges',
    frameIntervals: { webglMs: 151.7, webgpuMs: 68.5 },
  }),
  pages: [{
    kind: 'markdown',
    id: 'layout',
    title: 'About the layout',
    load: async (): Promise<string> => (await import('./layout.md?raw')).default,
  }],
})
