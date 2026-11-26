import { defineExperiment } from '../../runtime/experiment'
import type { ExperimentCase } from '../../runtime/experiment'
import { motionCase } from './motion'
import { exactLineCases, lineCases } from './fixture'

export const experiment = defineExperiment({
  id: 'production-lines',
  title: 'Lines in the Cosmos packages',
  summary: 'Compare link pixels and click targets in the built WebGL and WebGPU Graph packages.',
  tags: ['links', 'picking', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  caseChooserLabel: 'Link fixture',
  howItWorks: {
    summary: 'Both Graphs draw the same links and replay identical clicks. Change the geometry or pixel ratio to compare the canvases and selected IDs.',
  },
  cases: [...Object.entries(lineCases).map(([id, title]): ExperimentCase => ({
    id,
    title,
    kind: 'compare',
    question: `Which pixels and click targets differ between the packages for ${title.toLowerCase()}?`,
    description: 'Frozen positions, a crossing, a subpixel stroke and a foreground point.',
    reference: 'The same public Graph application running the WebGL package.',
    acceptance: exactLineCases.has(id)
      ? 'Every RGBA pixel and click result matches.'
      : 'Report every RGBA difference. Require exact click IDs, silhouettes within one device pixel and interior channels within two levels.',
    recorded: {
      date: '2026-11-24',
      environment: 'Chrome on Apple M3 and SwiftShader',
      scope: 'Four links before and after a public endpoint edit at pixel ratios 1 and 2.',
      conclusion: exactLineCases.has(id)
        ? 'Every pixel and expected click target matched on both adapters.'
        : 'Both packages met the outline, interior color and click-target checks. The results table gives the exact pixel counts.',
      limits: 'Opaque links, one camera per fixture and one feature at a time.',
      evidence: [{ label: 'Package comparison results', page: 'results' }],
    },
  })), {
    id: motionCase,
    title: 'Dashed endpoint motion',
    kind: 'compare',
    question: 'Do both packages keep the same dashes visible and clickable as their endpoints move across a pixel?',
    description: 'Two vertical 2.3 CSS-pixel strokes face in opposite directions. Scrub one device pixel to either side of the rounding tie.',
    reference: 'The workspace WebGL Graph uses the same public endpoint edits and receives the same clicks.',
    acceptance: 'Preserve complete dashes and click IDs. Compare edge displacement, interior color and unexpected flashes against the WebGL sequence.',
    recorded: {
      date: '2026-11-24',
      environment: 'Chrome on Apple M3 and SwiftShader',
      scope: 'Two oppositely directed links, dashed and solid, 65 phases in each direction at pixel ratios 1 and 2.',
      conclusion: 'Both packages preserved complete dashes, the expected click targets and the temporal and spatial budgets.',
      limits: 'A fixed camera and vertical 2.3 CSS-pixel strokes.',
      evidence: [{ label: 'Endpoint motion results', page: 'results' }],
    },
  }],
  create: async (host, caseId) => (await import('./view')).createLinesView(host, caseId),
  pages: [
    { kind: 'markdown', id: 'method', title: 'How links are compared', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'results', title: 'Package comparison results', load: async (): Promise<string> => (await import('./results.md?raw')).default },
  ],
})
