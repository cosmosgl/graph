import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'point-styling',
  title: 'Point styling and picking',
  summary: 'Explore point shapes, picking, images and visual effects.',
  tags: ['rendering', 'picking', 'WebGL', 'WebGPU'],
  cases,
  create: async (host, caseId) => (await import('./view')).createStylingView(host, caseId),
  pages: [
    {
      kind: 'markdown',
      id: 'shapes-evidence',
      title: 'Point-shape evidence',
      load: async (): Promise<string> => (await import('./shapes-evidence.md?raw')).default,
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
    { kind: 'markdown', id: 'method', title: 'Method and findings', load: async (): Promise<string> => (await import('./method.md?raw')).default },
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
      load: async (): Promise<string> => (await import('./transition-findings.md?raw')).default,
    },
  ],
})
