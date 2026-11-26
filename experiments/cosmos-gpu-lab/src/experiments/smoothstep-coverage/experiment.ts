import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
import './styles.css'

export const experiment = defineExperiment({
  id: 'smoothstep-coverage',
  title: 'Why a line edge changes',
  summary: 'Compare two ways of calculating the same line edge in WebGL and WebGPU.',
  tags: ['rendering', 'links', 'precision', 'WebGL', 'WebGPU'],
  cases,
  howItWorks: false,
  showRecordedSummary: false,
  showPeerLinks: false,
  initialEvidence: 'first-recorded',
  create: async host => (await import('./view')).createSmoothstepView(host),
  pages: [
    {
      kind: 'markdown',
      id: 'case-evidence',
      title: 'Line-edge evidence',
      load: async (): Promise<string> => (await import('./case-evidence.md?raw')).default,
    },
    { kind: 'markdown', id: 'method', title: 'How the comparison works', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'M3 result', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
  ],
})
