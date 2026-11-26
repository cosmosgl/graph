import { defineExperiment } from '../../runtime/experiment'
import type { ExperimentPage } from '../../runtime/experiment'
import type { LiveCheckGroup } from '../../runtime/live-checks'
import { cases, pointStylingExperimentIds } from './cases'

const evidencePages: ExperimentPage[] = [
  {
    kind: 'markdown',
    id: 'shapes-evidence',
    relatedExperiments: ['integrated-webgpu'],
    title: 'How point shapes work',
    load: async (): Promise<string> => (await import('./shapes-evidence.md?raw')).default,
  },
  {
    kind: 'live-checks',
    id: 'automated-cases',
    title: 'Automated test results',
    load: async (): Promise<readonly LiveCheckGroup[]> => (await import('./shapes-suite')).shapeGroups,
  },
  {
    kind: 'markdown',
    id: 'picking-evidence',
    title: 'Point-picking evidence',
    load: async (): Promise<string> => (await import('./picking-evidence.md?raw')).default,
  },
  {
    kind: 'markdown',
    id: 'images-evidence',
    title: 'Point-image evidence',
    load: async (): Promise<string> => (await import('./images-evidence.md?raw')).default,
  },
  {
    kind: 'markdown',
    id: 'effects-evidence',
    title: 'Ring and greyout evidence',
    load: async (): Promise<string> => (await import('./effects-evidence.md?raw')).default,
  },
]

// Point shapes also hosts the original shared studies for existing evidence links.
const archivePages: ExperimentPage[] = [
  {
    kind: 'markdown',
    id: 'method',
    title: 'Original point styling and picking study',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  },
  {
    kind: 'markdown',
    id: 'transition-method',
    title: 'Point transition protocol',
    load: async (): Promise<string> => (await import('./transition-method.md?raw')).default,
  },
  {
    kind: 'markdown',
    id: 'transition-findings',
    title: 'Point transitions and exits',
    relatedExperiments: ['production-graph-api'],
    load: async (): Promise<string> => (await import('./transition-findings.md?raw')).default,
  },
]

export const experiments = cases.map(item => defineExperiment({
  id: pointStylingExperimentIds[item.id],
  title: item.title,
  summary: item.description,
  tags: ['rendering', 'picking', 'WebGL', 'WebGPU'],
  cases: [item],
  ...item.id === 'shapes' ? { presentation: 'demo', headerContent: 'question-only', showRecordedSummary: false, howItWorks: false } as const : {},
  create: async host => item.id === 'shapes'
    ? (await import('./shapes-view')).createShapesView(host)
    : (await import('./view')).createStylingView(host, item.id),
  pages: [
    ...evidencePages.filter(page => item.recorded.evidence.some(link => link.page === page.id)),
    ...item.id === 'shapes' ? archivePages : [],
  ],
}))
