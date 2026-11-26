import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'combined-layout',
  title: 'Combined layout convergence',
  summary: 'Compose gravity, hierarchical repulsion, ordered springs and cooling; compare settling layouts and full-strength residual motion.',
  tags: ['simulation', 'convergence', 'WebGL', 'WebGPU'],
  cases,
  create: async host => (await import('./view')).createCombinedView(host),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'Comparison method',
    load: async (): Promise<string> => (await import('./docs/method.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'findings',
    title: 'Initial convergence study',
    load: async (): Promise<string> => (await import('./docs/findings.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'checkpoints',
    title: 'Checkpoint and replay validation',
    load: async (): Promise<string> => (await import('./docs/checkpoints.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'spring-precision',
    title: 'Early spring precision',
    load: async (): Promise<string> => (await import('./docs/spring-precision.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'spring-cost',
    title: 'Frozen spring arithmetic cost',
    load: async (): Promise<string> => (await import('./docs/spring-cost.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'spring-products',
    title: 'Targeted spring contribution rounding',
    load: async (): Promise<string> => (await import('./docs/spring-products.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'scaling',
    title: 'Initial 8,192-point scaling',
    load: async (): Promise<string> => (await import('./docs/scaling.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'tick-rounding',
    title: 'Repulsion integration alignment',
    load: async (): Promise<string> => (await import('./docs/tick-rounding.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'gravity-trig',
    title: 'Refined gravity and final 8,192-point matrix',
    load: async (): Promise<string> => (await import('./docs/gravity-trig.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'force-composition',
    title: 'Mouse repulsion, clusters and attractors',
    load: async (): Promise<string> => (await import('./docs/force-composition.md?raw')).default,
  }],
})
