import { defineExperiment } from '../../runtime/experiment'
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
  howItWorks: { summary: 'Each Graph draws the same four links. Move one endpoint or change the device pixel ratio to compare the full canvas and click IDs.' },
  cases: Object.entries(lineCases).map(([id, title]) => ({
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
  })),
  create: async (host, caseId) => (await import('./view')).createLinesView(host, caseId),
  pages: [
    { kind: 'markdown', id: 'method', title: 'How links are compared', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'results', title: 'Package comparison results', load: async (): Promise<string> => (await import('./results.md?raw')).default },
  ],
})
