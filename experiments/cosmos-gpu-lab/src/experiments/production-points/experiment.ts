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
    summary: 'Each canvas has eight shape columns. Choose a CSS pixel offset to compare integer and shifted centers, ' +
      'or choose rounding ties to place every center halfway between 1/16-device-pixel grid lines.',
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
      environment: 'Chrome 157 on Apple M3 (Metal) and SwiftShader',
      scope: `All eight shapes at four fractional diameters and three center presets, plus the 24 / 22 control at pixel ratio ${ratio}.`,
      conclusion: 'All 13 frames matched every RGBA byte on each tested adapter.',
      limits: 'Opaque fills and a fixed camera. Other M3 sizes and offsets showed one-level edge differences.',
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
