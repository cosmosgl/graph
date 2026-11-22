import { defineExperiment } from '../../runtime/experiment'
import { boundsCase, editCase, timingCase } from './cases'

export const experiments = [
  defineExperiment({
    id: 'resident-layout',
    title: 'GPU layout bounds',
    summary: 'Check that WebGPU can build the repulsion grid without downloading point positions every step.',
    tags: ['simulation', 'integration', 'WebGPU'],
    cases: [boundsCase],
    presentation: 'finding-first',
    create: async host => (await import('./view')).createResidentView(host, 'compare'),
    pages: [{
      kind: 'markdown',
      id: 'method',
      title: 'Why it matters for WebGPU',
      load: async (): Promise<string> => (await import('./method.md?raw')).default,
    }, {
      kind: 'markdown',
      id: 'checklist',
      title: 'Migration checklist',
      relatedExperiments: ['combined-layout', 'resident-frame-timing', 'resident-layout-edits', 'integrated-webgpu'],
      load: async (): Promise<string> => (await import('./checklist.md?raw')).default,
    }],
  }),
  defineExperiment({
    id: 'resident-layout-edits',
    title: 'Editing a running layout',
    summary: 'Move a point or replace the links without restarting the simulation.',
    tags: ['simulation', 'updates', 'WebGPU'],
    cases: [editCase],
    showRecordedSummary: false,
    renderExplanation: (): string => `<p>Moving and pinning a point writes its new position into the buffers
      the simulation already uses. Replacing links updates the connections while keeping the current positions.
      The next step starts from that edited layout.</p>`,
    create: async host => (await import('./view')).createResidentView(host, 'edit'),
    pages: [{
      kind: 'markdown',
      id: 'method',
      title: 'Updating a running layout',
      relatedExperiments: ['point-capacity', 'resident-frame-timing'],
      load: async (): Promise<string> => (await import('./edits.md?raw')).default,
    }],
  }),
  defineExperiment({
    id: 'resident-frame-timing',
    title: 'Timing a GPU layout frame',
    summary: 'Measure WebGPU simulation and basic drawing on your device.',
    tags: ['simulation', 'performance', 'WebGPU'],
    cases: [timingCase],
    showRecordedSummary: false,
    renderExplanation: (): string => `<p>Each run measures the first few steps of the same starting layout.
      The simulation-only runs apply the forces. The drawing runs also render the points and links
      into a fixed 480 × 340 target.</p>`,
    create: async host => (await import('./timing-view')).createTimingView(host),
    pages: [{
      kind: 'markdown',
      id: 'recorded',
      title: 'Recorded frame timings',
      relatedExperiments: ['combined-layout', 'resident-layout-edits'],
      load: async (): Promise<string> => (await import('./timing-updates.md?raw')).default,
    }, {
      kind: 'markdown',
      id: 'method',
      title: 'Measuring a GPU layout frame',
      load: async (): Promise<string> => (await import('./frame-timing.md?raw')).default,
    }],
  }),
]
