import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'production-graph-api',
  title: 'Run the same Graph application',
  summary: 'Compare manual stepping, point removal, moving selection and tracked labels through the two built Cosmos packages.',
  tags: ['integration', 'interaction', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  howItWorks: {
    summary: 'The panes run the same application with the built WebGL and WebGPU Graph packages.',
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
  }, {
    id: 'sparse-transition',
    title: 'Remove and restore a point',
    kind: 'compare',
    question: 'What can you see and pick while a point and its link disappear and return?',
    description: 'Replace one position with NaN, then restore its original index. Choose a frame to inspect the drawing and click targets.',
    reference: 'Identical position edits and clicks in the workspace WebGL Graph.',
    acceptance: 'The point and its link follow the reference fade and click behavior. The other two points keep their positions and IDs.',
    recorded: null,
  }],
  create: async (host, caseId) => caseId === 'sparse-transition'
    ? (await import('./sparse-view')).createSparseView(host)
    : (await import('./view')).createPackageView(host),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'Reproduce the package comparison',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'youtube-selection',
    title: 'Moving YouTube selection and labels',
    load: async (): Promise<string> => (await import('./youtube-selection.md?raw')).default,
  }],
})
