import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'production-points',
  title: 'Points in the Cosmos packages',
  summary: 'Compare the pixels of eight point shapes at integer and fractional sizes and positions.',
  tags: ['points', 'shapes', 'rendering', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  caseChooserLabel: 'Pixel ratio',
  howItWorks: {
    summary: 'Each canvas has eight shape columns. From top to bottom, the rows use integer inputs, fractional diameters, ' +
      'fractional positions, and both together. The two graphs use identical drawing calls and a fixed camera.',
  },
  cases: ([1, 2] as const).map(ratio => ({
    id: `dpr-${ratio}`,
    title: `${ratio}×`,
    kind: 'compare',
    question: `Which of the eight point shapes match WebGL pixel for pixel at ${ratio}×?`,
    description: 'Each package draws the same 32 points into its own canvas.',
    reference: 'The workspace WebGL Graph running the same application.',
    acceptance: 'All four channels of every device pixel must agree.',
    recorded: {
      date: '2026-11-24',
      environment: 'Native Chrome on Apple M3, Metal',
      scope: `All eight shapes at five diameters and two center placements, pixel ratio ${ratio}.`,
      conclusion: 'Every pixel matched for all eight shapes at all four fractional diameters and the 22 CSS pixel control.',
      limits: 'Opaque fills, fixed camera and one tested GPU.',
      evidence: [{ label: 'Exact pixel counts', page: 'results' }],
    },
  })),
  create: async (host, caseId) => (await import('./view')).createPointsView(host, caseId),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'How the shapes are compared',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'results',
    title: 'Exact pixel counts',
    load: async (): Promise<string> => (await import('./results.md?raw')).default,
  }],
})
