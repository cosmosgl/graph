import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'production-graph-api',
  title: 'Run the same Graph application',
  summary: 'Compare one gravity step and point selection through the two built Cosmos packages.',
  tags: ['integration', 'interaction', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  howItWorks: {
    summary: 'Click a point in either graph to see its ID. Step gravity to pull the blue endpoint toward the center. The red endpoint stays pinned.',
  },
  cases: [{
    id: 'manual-step',
    title: 'A pinned point and a moving endpoint',
    kind: 'compare',
    question: 'Do both Graph packages draw, pick and step the same points?',
    description: 'Each frame runs the same application against its own built Graph package.',
    reference: 'The WebGL package and the fixed positions and IDs used in the Manual step Storybook example.',
    acceptance: 'Point 0 stays pinned, point 1 moves toward the center and point 2 stays absent. Clicking a visible point reports its ID.',
    recorded: null,
  }],
  create: async host => (await import('./view')).createPackageView(host),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'Reproduce the package comparison',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }],
})
