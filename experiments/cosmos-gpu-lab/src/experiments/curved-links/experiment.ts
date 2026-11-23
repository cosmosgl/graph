import { defineExperiment } from '../../runtime/experiment'
import type { LiveCheckGroup } from '../../runtime/live-checks'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'curved-links',
  title: 'Curved-link rendering and picking',
  summary: 'Compare which pixels a solid curve paints and which link a click selects.',
  tags: ['rendering', 'links', 'curves', 'picking', 'WebGL', 'WebGPU'],
  cases,
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  howItWorks: {
    relatedExperiments: ['straight-links'],
    summary: `### Solid curves in the WebGPU pilot

Solid curves are in scope for integration. The pilot keeps the **Cosmos (+5 CSS px)** click target, so a click just outside a thin curve can still select it. Where curves overlap, the same link should win as in WebGL.

The pilot allows the painted edge and the edge of the click target to shift by up to one device pixel. Thin curves must stay visible, and colors and picks must still agree away from those edges.

The demo holds the curves still and checks each renderer’s pick against a CPU calculation. It reports exact pick differences, including ones right on the edge. With **Drawn faces**, the default bow can look the same but give different picks. With **Hard** edges, its color can differ too.

The automated checks below use the wider Cosmos target on frozen curves. Moving curves and performance in the integrated viewer are untested by this suite. Dashed and dotted curves remain outside the pilot.`,
  },
  create: async host => (await import('./view')).createCurvesView(host),
  pages: [
    {
      kind: 'live-checks',
      id: 'automated-cases',
      title: 'Automated test results',
      load: async (): Promise<LiveCheckGroup[]> => (await import('./pilot-suite')).curveGroups,
    },
    {
      kind: 'markdown',
      id: 'case-evidence',
      title: 'Recorded curve checks',
      load: async (): Promise<string> => (await import('./case-evidence.md?raw')).default,
    },
  ],
})
