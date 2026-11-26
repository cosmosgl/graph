import { defineExperiment } from '../../runtime/experiment'

const recorded = {
  date: '2026-11-24',
  environment: 'Native Chrome on Apple M3, Metal, pixel ratio 1',
  conclusion: 'All point coordinates and all 49,152 canvas pixels matched at every tick from 0 through 8.',
  limits: 'One fixed camera and one contact group. The additional grid points in the hashed case are widely spaced.',
  evidence: [{ label: 'Measured positions and pixels', page: 'results' }],
}

export const experiment = defineExperiment({
  id: 'production-force-collision',
  title: 'ForceCollision in the Cosmos packages',
  summary: 'Step the WebGL and WebGPU Graph together and compare every point coordinate and canvas pixel.',
  tags: ['collision', 'forces', 'rendering', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  headerContent: 'question-only',
  caseChooserLabel: 'Collision path',
  showRecordedSummary: false,
  howItWorks: {
    summary: 'Both graphs start paused. Step collision advances each graph by one tick with two collision iterations. ' +
      'The coral point stays pinned while its neighbors can move. Both views use the same fixed camera.',
  },
  cases: [{
    id: 'contacts',
    title: 'All pairs · 7 slots',
    kind: 'compare',
    question: 'Do the two Graph packages resolve these overlapping circles to the same positions and draw the same pixels?',
    description: 'Six visible circles and one absent slot exercise the small-graph collision path.',
    reference: 'The WebGL package running the same seven-slot scene.',
    acceptance: 'All position pairs and every RGBA pixel match exactly at the selected tick.',
    recorded: { ...recorded, scope: 'Seven slots at every tick from 0 through 8.' },
  }, {
    id: 'hashed',
    title: 'Hashed grid · 4,097 slots',
    kind: 'compare',
    question: 'Do positions and pixels still match when ForceCollision switches to its hashed grid?',
    description: 'A grid of 4,090 offscreen points brings the same scene above the 4,096-slot cutoff. Every position is compared.',
    reference: 'The WebGL package running the same seeded 4,097-slot scene.',
    acceptance: 'All position pairs match across the full graph, and every RGBA pixel of the visible cluster matches exactly.',
    recorded: { ...recorded, scope: 'All 4,097 slots at every tick from 0 through 8.' },
  }],
  create: async (host, caseId) => (await import('./view')).createCollisionView(host, caseId),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'How positions and pixels are compared',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'results',
    title: 'Measured positions and pixels',
    load: async (): Promise<string> => (await import('./results.md?raw')).default,
  }],
})
