import { defineExperiment } from '../../runtime/experiment'
import type { LiveCheckGroup } from '../../runtime/live-checks'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'straight-links',
  title: 'Straight-link rendering and picking',
  summary: 'Compare the pixels WebGL and WebGPU paint and the link each one picks.',
  tags: ['rendering', 'links', 'picking', 'WebGL', 'WebGPU'],
  cases,
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  howItWorks: {
    relatedExperiments: ['integrated-webgpu', 'smoothstep-coverage'],
    summary: 'Cosmos draws each straight link as two triangles. The [first WebGPU version](#/integrated-webgpu) covers solid links. ' +
      'Dashed and dotted links are outside its scope. At the sides and ends of a solid link, the outline may shift by one device pixel. ' +
      'Thin links must still be visible.\n\n' +
      'Cosmos picking adds five CSS pixels to the stroke width and includes dash gaps. Visible stroke picks only the drawn width and skips gaps. ' +
      'To check a pick at a crossing, the demo draws the selected link alone and checks whether it paints that pixel.',
  },
  create: async host => (await import('./view')).createLinksView(host),
  pages: [
    {
      kind: 'live-checks',
      id: 'automated-cases',
      title: 'Automated test results',
      load: async (): Promise<LiveCheckGroup[]> => (await import('./links-suite')).linkGroups,
    },
  ],
})
